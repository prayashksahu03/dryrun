from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Any, Optional, List
from collections import OrderedDict
import json
import os
import re
import hashlib
import shutil
import signal
import subprocess
import tempfile
import time

try:
    import resource  # Unix-only; present on Linux (Render) and macOS.
    _RESOURCE_AVAILABLE = True
except Exception:  # pragma: no cover - non-Unix
    resource = None            # type: ignore
    _RESOURCE_AVAILABLE = False

from dotenv import load_dotenv
load_dotenv()  # load backend/.env into os.environ before anything reads it

# The Explain LLM client is optional and provider-agnostic (OpenAI-compatible).
# Guarded so a missing/broken SDK can never stop the app or affect /execute.
try:
    from openai import OpenAI
    import openai as _openai_mod
    _OPENAI_AVAILABLE = True
except Exception:  # pragma: no cover - only when the SDK isn't installed
    OpenAI = None            # type: ignore
    _openai_mod = None       # type: ignore
    _OPENAI_AVAILABLE = False

from interpreter.interpreter import CInterpreter
from interpreter.cpp_interpreter import CppInterpreter
from interpreter.python_tracer import PythonTracer
from interpreter.semantic_views import annotate_trace

app = FastAPI(title="MemTrace Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Failure log ──────────────────────────────────────────────────────────────
# Every program DryRun can't run is recorded here (JSONL). This is the honest
# "escape hatch" data source: it turns real usage into a frequency-ranked list of
# what to support next, and — once there's demand — the evidence for whether the
# remaining gaps justify a real-execution backend. Best-effort: logging never
# affects the response.
FAILURE_LOG = os.path.join(os.path.dirname(__file__), 'failure_log.jsonl')


def _log_failure(source: str, language: str, kind: str, message: str) -> None:
    try:
        rec = {
            'ts': datetime.now(timezone.utc).isoformat(),
            'language': language,
            'kind': kind,                 # 'unsupported' | 'user_error'
            'message': message[:500],
            'source': source[:12000],
        }
        with open(FAILURE_LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec) + '\n')
    except Exception:
        pass  # never let logging break a request


class ExecuteRequest(BaseModel):
    source: str
    language: str = 'c'   # 'c' | 'cpp' | 'python'
    stdin_input: str = ''


class ReportRequest(BaseModel):
    source: str
    language: str = 'cpp'
    note: str = ''        # optional: what the user expected / what looked wrong


@app.post("/execute")
async def execute(req: ExecuteRequest):
    if not req.source.strip():
        raise HTTPException(status_code=400, detail="Source code cannot be empty.")
    if len(req.source) > 12000:
        raise HTTPException(status_code=400, detail="Source code too long (max 12000 chars).")

    lang = req.language.lower().strip()

    try:
        if lang == 'python':
            tracer = PythonTracer(req.source)
            trace = tracer.run()
            return {"trace": annotate_trace(trace), "source": req.source}

        if lang in ('cpp', 'c++'):
            interp = CppInterpreter(req.source, stdin_data=req.stdin_input)
        else:
            interp = CInterpreter(req.source)

        trace = interp.run()
        return {"trace": annotate_trace(trace), "source": req.source}

    except ValueError as e:
        # A compile/parse/validation error the user can act on — surface as-is.
        _log_failure(req.source, lang, 'user_error', str(e))
        raise HTTPException(status_code=400, detail=str(e))

    except Exception as e:
        # The interpreter itself couldn't run this program — a coverage gap, not
        # a user mistake. Be honest ("can't visualize this yet"), never a crash,
        # and log the source so the gap becomes roadmap data.
        _log_failure(req.source, lang, 'unsupported', f"{type(e).__name__}: {e}")
        raise HTTPException(
            status_code=422,
            detail=("DryRun can't visualize this program yet — it uses something the "
                    "interpreter doesn't handle. This has been logged so we can add "
                    f"support. (internal: {type(e).__name__})"),
        )


@app.post("/report")
async def report(req: ReportRequest):
    """The interpreter usually fails SILENTLY — it runs and returns a trace, but
    the animation is degraded/wrong (not an exception). The system can't detect
    that without false positives, so the user is the ground truth: a one-click
    'this looks wrong' lands here. These reports are the highest-signal entries in
    the failure log — real trust-breaking cases, ranked by real user pain."""
    _log_failure(req.source, req.language, 'user_report',
                 req.note or 'user flagged the animation as wrong')
    return {"status": "logged"}


# ── Explain tutor (grounded LLM narration) ────────────────────────────────────
# A NARRATION layer only: the interpreter's trace is the deterministic source of
# truth. The LLM never computes or executes anything — it explains, strictly
# grounded in the trace facts the frontend hands it. Provider-agnostic via an
# OpenAI-compatible endpoint; defaults to a local Ollama + Qwen2.5-Coder so no
# key is needed and code never leaves the machine. Swap provider via .env only.
EXPLAIN_BASE_URL = os.getenv("EXPLAIN_BASE_URL", "http://localhost:11434/v1")
EXPLAIN_MODEL    = os.getenv("EXPLAIN_MODEL", "qwen2.5-coder:7b")  # default pairs with local Ollama; override via .env
EXPLAIN_API_KEY  = os.getenv("EXPLAIN_API_KEY", "ollama")  # Ollama ignores it; real key for Groq/etc.
# Reasoning models (e.g. Groq's gpt-oss/qwen3) deliver much deeper output but emit
# <think> traces. Set EXPLAIN_REASONING=hidden to suppress them (Groq param); leave
# empty for non-reasoning models / Ollama. Reasoning eats tokens, so max_tokens is
# generous below to leave room for the answer after the thinking.
EXPLAIN_REASONING = os.getenv("EXPLAIN_REASONING", "")

_explain_client = None
_THINK_RE = re.compile(r'<think>.*?</think>\s*', re.DOTALL)


def _get_explain_client():
    """Lazy singleton. Returns None if the SDK isn't available so the endpoint
    can degrade gracefully instead of crashing."""
    global _explain_client
    if not _OPENAI_AVAILABLE:
        return None
    if _explain_client is None:
        # max_retries: the SDK retries transient 429/5xx/connection blips with
        # exponential backoff before surfacing — important on free-tier providers
        # (Groq) that briefly 503 under load. timeout is generous for reasoning models.
        _explain_client = OpenAI(
            base_url=EXPLAIN_BASE_URL, api_key=EXPLAIN_API_KEY,
            max_retries=4, timeout=90.0,
        )
    return _explain_client


def _chat(client, messages, max_tokens: int, temperature: float = 0.3, want_json: bool = False) -> str:
    """One chat completion, returning clean text. Adds reasoning_format (when
    configured) so reasoning models don't leak <think>; JSON mode with a graceful
    fallback; and a safety strip of any <think> block that slips through."""
    kwargs: dict = dict(model=EXPLAIN_MODEL, messages=messages, max_tokens=max_tokens, temperature=temperature)
    if EXPLAIN_REASONING:
        kwargs["extra_body"] = {"reasoning_format": EXPLAIN_REASONING}
    if want_json:
        try:
            resp = client.chat.completions.create(response_format={"type": "json_object"}, **kwargs)
            return _THINK_RE.sub('', resp.choices[0].message.content or "").strip()
        except Exception:
            pass  # provider rejected JSON mode — fall through to plain + tolerant parse
    resp = client.chat.completions.create(**kwargs)
    return _THINK_RE.sub('', resp.choices[0].message.content or "").strip()


def _llm_http_error(e: Exception) -> HTTPException:
    """Map an LLM-client exception to a friendly HTTP error. Provider-neutral
    (works for Ollama, Groq, etc.) and inspects names/status so we don't need to
    hard-import the SDK's exception classes."""
    name = type(e).__name__
    status = getattr(e, 'status_code', None) or getattr(e, 'status', None)
    # Log the real cause so failures are never invisible (handled exceptions
    # otherwise produce no traceback in the uvicorn log).
    print(f"[tutor] LLM call failed → {name} (status={status}): {str(e)[:300]}", flush=True)
    if 'RateLimit' in name or status == 429:
        return HTTPException(
            status_code=429,
            detail="The tutor is busy right now (rate limit) — try again in a few seconds.")
    if 'Connection' in name or 'Timeout' in name or status == 503:
        return HTTPException(
            status_code=503,
            detail="The tutor's model provider is unreachable right now. Try again shortly.")
    if 'Authentication' in name or status in (401, 403):
        return HTTPException(
            status_code=502,
            detail="The tutor's LLM API key looks invalid — check EXPLAIN_API_KEY on the server.")
    return HTTPException(status_code=502, detail=f"LLM error ({name}). Try again.")


EXPLAIN_SYSTEM = (
    "You are a C/C++ execution tutor inside DryRun. A deterministic interpreter has already "
    "executed the program and produced the trace facts below — they are the ONLY source of truth.\n"
    "Rules:\n"
    "- Explain ONLY from the provided facts. Never compute, evaluate, simulate, or predict any value.\n"
    "- Every number, address, variable value, or memory state you mention must appear verbatim in "
    "the facts. If a needed fact is absent, say \"the trace doesn't show that\" — never guess or infer.\n"
    "- Do not speculate about steps outside the provided window.\n"
    "- 2-4 sentences, plain and concrete; cite the actual values (e.g. the specific dist[] entries).\n"
    "- No code rewrites, no \"you should\", no fabricated line numbers."
)

# In-memory LRU cache: identical (source, step, mode, question) never calls twice.
_EXPLAIN_CACHE: "OrderedDict[str, str]" = OrderedDict()
_EXPLAIN_CACHE_MAX = 512
_SNAPSHOT_CHAR_CAP = 40000  # trim pathological heaps/grids before prompting


class ExplainStep(BaseModel):
    index: int
    line: int
    description: str = ''
    event: dict[str, Any] = {}


class ExplainRequest(BaseModel):
    source: str
    current_step: int
    mode: str = 'step'                 # 'step' | 'question'
    question: Optional[str] = None
    window: List[ExplainStep] = []     # ~6 steps ending at current_step (no per-step memory)
    snapshot: dict[str, Any] = {}      # current step only: {memory, execution?, graph?, grid?, ...}
    notable: List[ExplainStep] = []    # whole-run crashes/warnings/end — for "what went wrong" Qs


class ExplainResponse(BaseModel):
    explanation: str
    cached: bool = False
    model: str


def _cache_key(req: ExplainRequest) -> str:
    h = hashlib.sha256(req.source.encode('utf-8', 'ignore')).hexdigest()[:16]
    return f"{h}:{req.current_step}:{req.mode}:{req.question or ''}"


def _event_summary(event: dict) -> str:
    """A short, human-readable one-liner for a StepEvent — kept compact for the prompt."""
    if not isinstance(event, dict):
        return ''
    t = event.get('type', '')
    if t == 'assign':
        return f"assign {event.get('target', '')} = {event.get('value', '')}"
    if t == 'malloc':
        return f"malloc {event.get('typeName', '')} -> {event.get('address', '')}"
    if t == 'free':
        return f"free {event.get('address', '')}"
    if t == 'call':
        return f"call {event.get('name', '')}"
    if t == 'return':
        return f"return {event.get('value', '')}"
    if t in ('crash', 'warning'):
        return f"{t} {event.get('kind', '')}: {event.get('message', '')}"
    if t == 'output':
        return f"output {event.get('text', '')!r}"
    if t == 'end':
        leaks = event.get('leaks') or []
        return f"end (leaks: {len(leaks)})"
    return t


def _build_facts(req: ExplainRequest) -> str:
    """Render the grounding facts block the LLM sees. All facts come from the trace."""
    parts: List[str] = []
    parts.append("Source:\n```cpp\n" + req.source + "\n```")

    if req.window:
        lines = []
        for s in req.window:
            marker = "  <-- current step" if s.index == req.current_step else ""
            summ = _event_summary(s.event)
            summ = f"  [{summ}]" if summ else ""
            lines.append(f"#{s.index} line {s.line}: {s.description}{summ}{marker}")
        parts.append("Recent steps (ending at the current step):\n" + "\n".join(lines))

    snap = req.snapshot or {}
    mem = snap.get('memory')
    if mem is not None:
        parts.append("Current memory (stack + heap):\n" + json.dumps(mem, default=str))
    for key in ('execution', 'graph', 'grid', 'deps', 'dsu'):
        val = snap.get(key)
        if val:
            parts.append(f"{key} descriptor:\n" + json.dumps(val, default=str))

    # Whole-run diagnostics — crashes, warnings, and the final/end step. These are
    # often the real answer to "what's the error / why did it crash", even when
    # they occurred far from the current step's window.
    if req.notable:
        lines = []
        for s in req.notable:
            summ = _event_summary(s.event)
            summ = f"  [{summ}]" if summ else ""
            lines.append(f"#{s.index} line {s.line}: {s.description}{summ}")
        parts.append("Notable events across the full run (warnings / crashes / program end):\n"
                     + "\n".join(lines))

    facts = "\n\n".join(parts)
    if len(facts) > _SNAPSHOT_CHAR_CAP:
        facts = facts[:_SNAPSHOT_CHAR_CAP] + "\n...(facts truncated for size)"

    if req.mode == 'question' and req.question:
        facts += f"\n\nQuestion from the learner: {req.question}\nAnswer using only the facts above."
    else:
        facts += (f"\n\nExplain what happens at the current step (#{req.current_step}) and why, "
                  "using only the facts above.")
    return facts


def _run_explain(req: ExplainRequest) -> str:
    client = _get_explain_client()
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Explain is unavailable — the LLM client isn't installed on the server "
                   "(pip install openai).")
    return _chat(client, [
        {"role": "system", "content": EXPLAIN_SYSTEM},
        {"role": "user",   "content": _build_facts(req)},
    ], max_tokens=1200, temperature=0.2)


@app.post("/explain", response_model=ExplainResponse)
async def explain(req: ExplainRequest):
    if len(req.source) > 12000:
        raise HTTPException(status_code=400, detail="Source code too long (max 12000 chars).")

    key = _cache_key(req)
    if key in _EXPLAIN_CACHE:
        _EXPLAIN_CACHE.move_to_end(key)
        return ExplainResponse(explanation=_EXPLAIN_CACHE[key], cached=True, model=EXPLAIN_MODEL)

    try:
        text = _run_explain(req)
    except HTTPException:
        raise
    except Exception as e:
        raise _llm_http_error(e)

    _EXPLAIN_CACHE[key] = text
    _EXPLAIN_CACHE.move_to_end(key)
    while len(_EXPLAIN_CACHE) > _EXPLAIN_CACHE_MAX:
        _EXPLAIN_CACHE.popitem(last=False)
    return ExplainResponse(explanation=text, cached=False, model=EXPLAIN_MODEL)


# ── Tutor walkthrough (LLM-driven guided tour) ────────────────────────────────
# The LLM picks the pedagogically important STEPS ("beats") and writes grounded
# narration for each. The frontend then drives the animation: goToStep(beat.step)
# moves the visualization AND highlights that step's code line. Still narration
# only — the LLM never computes; it chooses real step indices and explains facts.
WALKTHROUGH_SYSTEM = (
    "You are a data-structures & algorithms tutor guiding a student through a program's "
    "execution. A deterministic interpreter already ran it; the trace facts below are the "
    "ONLY source of truth.\n"
    "Choose 4 to 8 KEY moments (beats) that best teach how this program works: the setup, "
    "the important moments inside the main loop/recursion, and the outcome (final result or "
    "the bug). For each beat give the step index and a short explanation.\n"
    "Rules:\n"
    "- Pick ONLY step indices that appear in the facts.\n"
    "- Explain from the facts only; never compute, invent, or predict a value.\n"
    "- title: 3-6 words. narration: 1-2 plain sentences citing the real values at that step.\n"
    "- Order beats by step index ascending; don't repeat a step.\n"
    'Return ONLY a JSON object of this exact shape, no prose:\n'
    '{"beats": [{"step": <int>, "title": "<short>", "narration": "<1-2 sentences>"}, ...]}'
)

_WALK_CACHE: "OrderedDict[str, list]" = OrderedDict()
_WALK_CACHE_MAX = 128


class WalkStep(BaseModel):
    index: int
    line: int
    description: str = ''
    event: dict[str, Any] = {}


class WalkthroughRequest(BaseModel):
    source: str
    digest: List[WalkStep] = []      # compacted whole-trace step list (no memory)
    notable: List[WalkStep] = []     # crashes / warnings / end
    total_steps: int = 0
    question: Optional[str] = None    # if set: build a walkthrough TARGETED at this doubt


class Beat(BaseModel):
    step: int
    title: str
    narration: str


class WalkthroughResponse(BaseModel):
    beats: List[Beat]
    cached: bool = False
    model: str


def _parse_beats(text: str):
    """Extract the beats list from an LLM reply. Tolerates JSON-mode objects
    ({"beats": [...]}), a bare array, ``` fences, prose, and trailing commas."""
    if not text:
        return None
    text = text.strip()

    def _try(s):
        if not s:
            return None
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            try:  # tolerate trailing commas: [1,2,] / {..,}
                return json.loads(re.sub(r',(\s*[\]}])', r'\1', s))
            except json.JSONDecodeError:
                return None

    candidates = [text]
    mo = re.search(r'\{.*\}', text, re.DOTALL)
    if mo:
        candidates.append(mo.group(0))
    ma = re.search(r'\[.*\]', text, re.DOTALL)
    if ma:
        candidates.append(ma.group(0))

    for c in candidates:
        d = _try(c)
        if isinstance(d, dict) and isinstance(d.get('beats'), list):
            return d['beats']
        if isinstance(d, list):
            return d
    return None


def _build_walk_facts(req: WalkthroughRequest) -> str:
    parts = ["Source:\n```cpp\n" + req.source + "\n```"]
    if req.digest:
        lines = []
        for s in req.digest:
            summ = _event_summary(s.event)
            summ = f"  [{summ}]" if summ else ""
            lines.append(f"#{s.index} line {s.line}: {s.description}{summ}")
        parts.append(f"Execution trace ({req.total_steps} steps total; key steps shown):\n"
                     + "\n".join(lines))
    if req.notable:
        lines = [f"#{s.index} line {s.line}: {s.description}" for s in req.notable]
        parts.append("Notable events (warnings / crashes / end):\n" + "\n".join(lines))
    if req.question:
        parts.append(
            f"The student's specific doubt: \"{req.question}\"\n"
            "Build a FOCUSED walkthrough that resolves THIS doubt: choose the 3-6 steps where the "
            "relevant code executes (the exact lines / loop iterations the doubt is about), in the "
            "order that best explains it. Each narration must directly address the doubt using the "
            "real values at that step. If the doubt is about a specific line or variable, center the "
            "beats on where that line runs / that variable changes. Return the JSON object.")
    else:
        parts.append("Pick the 4-8 most instructive beats and return the JSON object.")
    return "\n\n".join(parts)


def _run_walkthrough(req: WalkthroughRequest) -> list:
    client = _get_explain_client()
    if client is None:
        raise HTTPException(status_code=503,
                            detail="Tutor is unavailable — the LLM client isn't installed.")
    facts = _build_walk_facts(req)
    if len(facts) > _SNAPSHOT_CHAR_CAP * 2:
        facts = facts[:_SNAPSHOT_CHAR_CAP * 2] + "\n...(truncated)"
    # Generous max_tokens: reasoning models think first, then emit the JSON beats.
    raw = _chat(client, [
        {"role": "system", "content": WALKTHROUGH_SYSTEM},
        {"role": "user",   "content": facts},
    ], max_tokens=3000, temperature=0.2, want_json=True)
    parsed = _parse_beats(raw)
    if not isinstance(parsed, list):
        raise HTTPException(status_code=502, detail="Tutor returned an unreadable plan. Try again.")

    # Validate: keep beats whose step index is real; clamp/dedupe; order ascending.
    valid_max = req.total_steps - 1 if req.total_steps > 0 else max(
        (s.index for s in req.digest), default=0)
    beats, seen = [], set()
    for b in parsed:
        if not isinstance(b, dict):
            continue
        try:
            step = int(b.get('step'))
        except (TypeError, ValueError):
            continue
        if step < 0 or step > valid_max or step in seen:
            continue
        seen.add(step)
        beats.append({
            'step': step,
            'title': str(b.get('title', ''))[:80],
            'narration': str(b.get('narration', ''))[:600],
        })
    beats.sort(key=lambda x: x['step'])
    if not beats:
        raise HTTPException(status_code=502, detail="Tutor couldn't build a valid walkthrough. Try again.")
    return beats


@app.post("/walkthrough", response_model=WalkthroughResponse)
async def walkthrough(req: WalkthroughRequest):
    if len(req.source) > 12000:
        raise HTTPException(status_code=400, detail="Source code too long (max 12000 chars).")
    key_src = req.source + "\x00" + (req.question or "")
    key = hashlib.sha256(key_src.encode('utf-8', 'ignore')).hexdigest()[:16]
    if key in _WALK_CACHE:
        _WALK_CACHE.move_to_end(key)
        return WalkthroughResponse(beats=_WALK_CACHE[key], cached=True, model=EXPLAIN_MODEL)
    try:
        beats = _run_walkthrough(req)
    except HTTPException:
        raise
    except Exception as e:
        raise _llm_http_error(e)
    _WALK_CACHE[key] = beats
    _WALK_CACHE.move_to_end(key)
    while len(_WALK_CACHE) > _WALK_CACHE_MAX:
        _WALK_CACHE.popitem(last=False)
    return WalkthroughResponse(beats=beats, cached=False, model=EXPLAIN_MODEL)


# ── Interview mode (LLM interviewer) ──────────────────────────────────────────
# The LLM plays a technical interviewer, questioning the candidate about the code
# they wrote — one question at a time, grounded in the actual code + a trace
# summary so it can probe correctness/complexity/edge-cases and check answers
# against what the code really does. Stateless: the frontend holds the transcript.
INTERVIEW_SYSTEM = (
    "You are a SENIOR technical interviewer running a rigorous coding interview (FAANG bar). The "
    "candidate wrote the code below. Interview them about THEIR code — go deep.\n"
    "Rules:\n"
    "- Ask ONE focused question at a time. No lists, no markdown bullets.\n"
    "- Skip shallow 'what does this do' questions. Probe DEPTH: exact time/space complexity and WHY; "
    "specific edge cases their code mishandles (empty input, cycles, disconnected parts, duplicates, "
    "overflow, single element); correctness under adversarial inputs; WHY this approach over "
    "alternatives (e.g. Kahn's vs DFS); what breaks if a precondition is violated; and trade-offs.\n"
    "- FOLLOW UP relentlessly. If an answer is vague or hand-wavy, drill in ('be specific — which line, "
    "and what exactly happens?'). If the answer CONTRADICTS the code (e.g. they say 'stack' but the "
    "code uses a queue), catch it and make them reconcile it with their actual code.\n"
    "- After each answer, give ONE crisp feedback sentence (right / partially / wrong, and why — "
    "grounded in the code + trace), THEN ask a HARDER follow-up that builds on what they just said. "
    "Escalate difficulty each turn.\n"
    "- Never invent behavior the code+trace don't show. Don't give away answers unless they're truly "
    "stuck (then a minimal hint). Keep each turn tight: 2-4 sentences."
)


class InterviewTurn(BaseModel):
    role: str            # 'interviewer' | 'candidate'
    content: str


class InterviewRequest(BaseModel):
    source: str
    summary: str = ''    # compact trace summary (output, algorithm, warnings) — optional grounding
    problem: str = ''    # the OA problem statement the candidate is solving — optional grounding
    history: List[InterviewTurn] = []


class InterviewResponse(BaseModel):
    message: str
    model: str


@app.post("/interview", response_model=InterviewResponse)
async def interview(req: InterviewRequest):
    if len(req.source) > 12000:
        raise HTTPException(status_code=400, detail="Source code too long (max 12000 chars).")
    client = _get_explain_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Interview is unavailable — the LLM client isn't installed.")

    context = ""
    if req.problem.strip():
        context += ("The candidate is solving THIS problem (from a company OA):\n"
                    + req.problem.strip()[:4000]
                    + "\n\nJudge their code against THIS problem — does it actually solve it? "
                    "Probe missed requirements, constraints, and edge cases the problem implies.\n\n")
    context += "Candidate's code:\n```cpp\n" + req.source + "\n```"
    if req.summary:
        context += "\n\nWhat the interpreter observed when running it:\n" + req.summary
    messages = [{"role": "system", "content": INTERVIEW_SYSTEM + "\n\n" + context}]

    if not req.history:
        messages.append({"role": "user", "content":
                         "Begin the interview: in one sentence say what my code appears to do, "
                         "then ask your first question."})
    else:
        for t in req.history[-16:]:  # bound context; recent turns are what matters
            role = "assistant" if t.role == "interviewer" else "user"
            messages.append({"role": role, "content": t.content})

    try:
        text = _chat(client, messages, max_tokens=1200, temperature=0.5)
    except Exception as e:
        raise _llm_http_error(e)
    if not text:
        raise HTTPException(status_code=502, detail="Interviewer returned an empty reply. Try again.")
    return InterviewResponse(message=text, model=EXPLAIN_MODEL)


# ── Convert: rewrite unsupported C++ into the DryRun-supported subset ─────────
# The escape hatch, turned into a feature: when the interpreter can't trace a
# program, the LLM rewrites it into semantically identical code using only
# constructs the tracer handles. The style contract below is empirical — derived
# from what demonstrably traces (demos, guided programs) and what demonstrably
# fails (competitive-style macro/tuple-heavy code).

CONVERT_SYSTEM = (
    "You rewrite C++ programs into a restricted, tracer-friendly subset WITHOUT changing behavior.\n"
    "The rewritten program MUST be semantically identical: same algorithm, same hardcoded data, "
    "same output, same complexity. Keep the author's variable and function names wherever legal.\n"
    "\n"
    "REWRITE RULES (the supported subset):\n"
    "- No #define macros. Replace macro types with plain types (write long long explicitly, or a typedef).\n"
    "- No C-style arrays of containers (e.g. vector<pair<int,int>> adj[n+1]) — use "
    "vector<vector<...>> name(n+1) instead.\n"
    "- No std::tuple, no std::array, no structured bindings (auto [a,b,c]), no std::tie, and no "
    "custom structs as container element types. Inside containers, pair is the ONLY compound "
    "element type allowed.\n"
    "- Multi-field rows (edge lists, triples) become PARALLEL plain vectors, e.g.:\n"
    "  vector<int> from; vector<int> to; vector<int> weight;\n"
    "  from.push_back(1); to.push_back(2); weight.push_back(4);\n"
    "- No brace-initialized container literals for complex element types "
    "(vector<tuple<...>> v = {{...}}) — build with sequential push_back calls.\n"
    "- Prefer indexed for-loops (for (int i = 0; i < v.size(); i++)) over range-for with auto "
    "when iterating containers of pairs.\n"
    "- No INT64_MAX / LLONG_MAX / INT_MAX macros — use an explicit literal constant "
    "(e.g. const long long INF = 1000000000000000LL;).\n"
    "- Allowed and encouraged: vector, pair, map, set, queue, stack, priority_queue "
    "(including greater<> min-heaps), string, plain functions with reference parameters, "
    "if/while/for, cout/cin, new/delete, structs with simple fields.\n"
    "- Keep #include <bits/stdc++.h> and using namespace std; as-is.\n"
    "- int main() is required.\n"
    "- Keep the program a single file and roughly the same length — this is a translation, "
    "not a refactor.\n"
    "\n"
    "Return ONLY the complete rewritten C++ source code. No markdown fences, no commentary."
)


class ConvertRequest(BaseModel):
    source: str
    language: str = 'cpp'
    error: str = ''      # the tracer's failure message — tells the LLM what broke


class ConvertResponse(BaseModel):
    code: str
    model: str


def _strip_code_fences(text: str) -> str:
    t = text.strip()
    if t.startswith('```'):
        first_nl = t.find('\n')
        if first_nl != -1:
            t = t[first_nl + 1:]
        if t.rstrip().endswith('```'):
            t = t.rstrip()[:-3]
    return t.strip()


@app.post("/convert", response_model=ConvertResponse)
async def convert(req: ConvertRequest):
    if not req.source.strip():
        raise HTTPException(status_code=400, detail="No source code provided.")
    if len(req.source) > 12000:
        raise HTTPException(status_code=400, detail="Source code too long (max 12000 chars).")
    client = _get_explain_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Convert is unavailable — the LLM client isn't installed.")

    user = "Rewrite this program into the supported subset:\n```cpp\n" + req.source + "\n```"
    if req.error.strip():
        user += "\n\nThe tracer failed with:\n" + req.error.strip()[:600] + \
                "\nMake sure the rewrite avoids whatever caused that."

    messages = [
        {"role": "system", "content": CONVERT_SYSTEM},
        {"role": "user", "content": user},
    ]
    try:
        text = _chat(client, messages, max_tokens=4000, temperature=0.2)
    except Exception as e:
        raise _llm_http_error(e)
    code = _strip_code_fences(text or '')
    if not code or 'main' not in code:
        raise HTTPException(status_code=502, detail="Conversion came back empty or invalid. Try again.")
    return ConvertResponse(code=code, model=EXPLAIN_MODEL)


# ══════════════════════════════════════════════════════════════════════════════
#  /judge — sandboxed test-case runner (LeetCode-style Run/Submit)
# ══════════════════════════════════════════════════════════════════════════════
# Runs UNTRUSTED student code. The outer boundary is Render's isolated container;
# every execution below is additionally bounded by an OS resource sandbox
# (setrlimit in a preexec_fn) + a wall-clock watchdog that SIGKILLs the whole
# process group. The LLM is never in this path. See backend/JUDGE.md.

def _judge_env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except Exception:
        return default


def _judge_env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except Exception:
        return default


# ── Env-tunable sandbox limits ────────────────────────────────────────────────
JUDGE_MAX_CASES         = _judge_env_int("JUDGE_MAX_CASES", 50)            # cases per request
JUDGE_MAX_SOURCE_LEN    = _judge_env_int("JUDGE_MAX_SOURCE_LEN", 64_000)   # chars of source
JUDGE_RUN_TIMEOUT_S     = _judge_env_float("JUDGE_RUN_TIMEOUT_S", 5.0)     # wall-clock per run
JUDGE_COMPILE_TIMEOUT_S = _judge_env_float("JUDGE_COMPILE_TIMEOUT_S", 10.0)# wall-clock for g++
JUDGE_TOTAL_TIMEOUT_S   = _judge_env_float("JUDGE_TOTAL_TIMEOUT_S", 30.0)  # wall-clock whole request
JUDGE_MEM_LIMIT_MB      = _judge_env_int("JUDGE_MEM_LIMIT_MB", 256)        # RLIMIT_AS per run
JUDGE_COMPILE_MEM_MB    = _judge_env_int("JUDGE_COMPILE_MEM_MB", 768)      # RLIMIT_AS for g++
JUDGE_CPU_LIMIT_S       = _judge_env_int("JUDGE_CPU_LIMIT_S", 5)           # RLIMIT_CPU per run
JUDGE_COMPILE_CPU_S     = _judge_env_int("JUDGE_COMPILE_CPU_S", 10)        # RLIMIT_CPU for g++
JUDGE_OUTPUT_LIMIT      = _judge_env_int("JUDGE_OUTPUT_LIMIT", 64 * 1024)  # stdout cap (bytes) + RLIMIT_FSIZE at run
JUDGE_COMPILE_FSIZE     = _judge_env_int("JUDGE_COMPILE_FSIZE", 64 * 1024 * 1024)  # RLIMIT_FSIZE for g++ (binary)
JUDGE_MSG_LIMIT         = _judge_env_int("JUDGE_MSG_LIMIT", 2048)          # compiler/stderr message cap (bytes)
JUDGE_NPROC_LIMIT       = _judge_env_int("JUDGE_NPROC_LIMIT", 64)          # RLIMIT_NPROC — contains fork bombs

_PR_SET_NO_NEW_PRIVS = 38  # <linux/prctl.h>
# A minimal environment for student code — critically, this is NOT os.environ, so
# LLM API keys and other secrets in the process env never reach untrusted code.
_JUDGE_CHILD_PATH = "/usr/local/bin:/usr/bin:/bin"


def _judge_setlimit(which, soft, hard=None):
    if not _RESOURCE_AVAILABLE:
        return
    try:
        resource.setrlimit(which, (soft, hard if hard is not None else soft))
    except Exception:
        pass  # macOS ignores some of these; the Docker/Render path is authoritative


def _judge_make_preexec(mem_mb: int, cpu_s: int, fsize: int, nproc: int):
    """Returns a preexec_fn (runs in the child, after fork, before exec)."""
    def _pre():
        # New session/process-group so the watchdog can SIGKILL the whole tree.
        os.setsid()
        _judge_setlimit(resource.RLIMIT_CPU, cpu_s, cpu_s + 1)      # SIGXCPU then SIGKILL
        _judge_setlimit(resource.RLIMIT_AS, mem_mb * 1024 * 1024)   # address space cap
        _judge_setlimit(resource.RLIMIT_FSIZE, fsize)               # file-write cap (SIGXFSZ)
        _judge_setlimit(resource.RLIMIT_CORE, 0)                    # no core dumps
        if nproc:
            _judge_setlimit(resource.RLIMIT_NPROC, nproc)           # cap process count (fork bombs)
        # no-new-privileges: student code can't gain privileges via setuid bins.
        try:
            import ctypes
            libc = ctypes.CDLL("libc.so.6", use_errno=True)
            libc.prctl(_PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
        except Exception:
            pass
    return _pre


def _judge_kill_group(proc: "subprocess.Popen") -> None:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _judge_read_capped(path: str, cap: int) -> str:
    try:
        with open(path, "rb") as f:
            data = f.read(cap + 1)
    except Exception:
        return ""
    truncated = len(data) > cap
    data = data[:cap]
    text = data.decode("utf-8", errors="replace")
    if truncated:
        text += "\n…[truncated]"
    return text


def _judge_run_once(argv, input_text, workdir, timeout, mem_mb, cpu_s, fsize):
    """Run one command under the sandbox. Returns a dict describing the outcome.
    stdin/stdout/stderr are files (no pipe deadlock, no unbounded parent memory)."""
    in_p = os.path.join(workdir, "stdin.txt")
    out_p = os.path.join(workdir, "stdout.txt")
    err_p = os.path.join(workdir, "stderr.txt")
    with open(in_p, "w", encoding="utf-8") as f:
        f.write(input_text or "")
    child_env = {"PATH": _JUDGE_CHILD_PATH, "LANG": "C.UTF-8",
                 "LC_ALL": "C.UTF-8", "HOME": workdir}
    timed_out = False
    fin = open(in_p, "rb")
    fout = open(out_p, "wb")
    ferr = open(err_p, "wb")
    start = time.perf_counter()
    try:
        proc = subprocess.Popen(
            argv, stdin=fin, stdout=fout, stderr=ferr, cwd=workdir,
            env=child_env, close_fds=True,
            preexec_fn=_judge_make_preexec(mem_mb, cpu_s, fsize, JUDGE_NPROC_LIMIT),
        )
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            _judge_kill_group(proc)   # kill the whole group, not just the pid
            try:
                proc.wait(timeout=5)
            except Exception:
                pass
    finally:
        for fh in (fin, fout, ferr):
            try:
                fh.close()
            except Exception:
                pass
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    # Ensure no orphaned children of this group survive.
    if timed_out:
        _judge_kill_group(proc)
    return {
        "returncode": proc.returncode if proc.returncode is not None else -signal.SIGKILL,
        "timed_out": timed_out,
        "stdout": _judge_read_capped(out_p, JUDGE_OUTPUT_LIMIT),
        "stderr": _judge_read_capped(err_p, JUDGE_MSG_LIMIT),
        "elapsed_ms": elapsed_ms,
    }


def _judge_normalize(s: str) -> str:
    """Mirror frontend outputsMatch: CRLF→LF, rstrip each line, strip trailing NLs."""
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln.rstrip() for ln in s.split("\n")]
    return "\n".join(lines).rstrip("\n")


def _judge_signal_message(sig: int, kind: str) -> str:
    try:
        name = signal.Signals(sig).name
    except Exception:
        name = str(sig)
    if sig == signal.SIGXFSZ:
        return f"Output limit exceeded (> {JUDGE_OUTPUT_LIMIT // 1024}KB written)"
    if sig == signal.SIGXCPU:
        return "CPU time limit exceeded"
    if sig == signal.SIGKILL:
        return "Killed — hit a memory or time limit"
    if sig == signal.SIGABRT:
        return f"Runtime error: aborted ({name}) — often an uncaught exception or bad_alloc"
    if sig == signal.SIGSEGV:
        return f"Runtime error: segmentation fault ({name})"
    return f"{kind}: process killed by signal {sig} ({name})"


def _judge_classify(case, r) -> dict:
    seq = case.seq
    tm = r["elapsed_ms"]
    if r["timed_out"]:
        return {"seq": seq, "verdict": "error",
                "message": f"Time limit exceeded (> {JUDGE_RUN_TIMEOUT_S:g}s)", "timeMs": tm}
    rc = r["returncode"]
    if rc < 0:
        msg = _judge_signal_message(-rc, "Runtime error")
        if r["stderr"].strip():
            msg = f"{msg}\n{r['stderr'].strip()}"
        return {"seq": seq, "verdict": "error", "message": msg[:JUDGE_MSG_LIMIT], "timeMs": tm}
    if rc != 0:
        msg = f"Runtime error: exited with code {rc}"
        if r["stderr"].strip():
            msg = f"{msg}\n{r['stderr'].strip()}"
        return {"seq": seq, "verdict": "error", "message": msg[:JUDGE_MSG_LIMIT], "timeMs": tm}
    # Exited cleanly — compare output.
    if _judge_normalize(r["stdout"]) == _judge_normalize(case.expected_output or ""):
        return {"seq": seq, "verdict": "passed", "stdout": r["stdout"], "timeMs": tm}
    return {"seq": seq, "verdict": "failed", "stdout": r["stdout"], "timeMs": tm}


class JudgeCase(BaseModel):
    seq: int
    input: str = ""
    expected_output: str = ""


class JudgeRequest(BaseModel):
    problem_id: Any = None       # accepts number|string; unused for now
    language: str
    source: str
    cases: List[JudgeCase] = []


def _judge_all(cases, verdict: str, message: str) -> dict:
    return {"results": [{"seq": c.seq, "verdict": verdict, "message": message} for c in cases]}


# NOTE: intentionally a *sync* def — FastAPI runs it in a threadpool, so the
# blocking subprocess/watchdog work never stalls the async event loop.
@app.post("/judge")
def judge(req: JudgeRequest):
    lang = (req.language or "").lower().strip()
    cases = list(req.cases or [])[:JUDGE_MAX_CASES]

    if not cases:
        return {"results": []}
    if lang not in ("cpp", "c++", "python", "py"):
        return _judge_all(
            cases, "error",
            f"Unsupported language '{req.language}'. Supported: cpp, python.")
    if not (req.source or "").strip():
        return _judge_all(cases, "error", "Source code is empty.")
    if len(req.source) > JUDGE_MAX_SOURCE_LEN:
        return _judge_all(
            cases, "error",
            f"Source too long (max {JUDGE_MAX_SOURCE_LEN} chars).")

    request_start = time.perf_counter()
    workdir = tempfile.mkdtemp(prefix="judge_")
    try:
        if lang in ("cpp", "c++"):
            with open(os.path.join(workdir, "src.cpp"), "w", encoding="utf-8") as f:
                f.write(req.source)
            comp = _judge_run_once(
                ["g++", "-std=c++17", "-O2", "-o", "bin", "src.cpp"],
                "", workdir, JUDGE_COMPILE_TIMEOUT_S,
                JUDGE_COMPILE_MEM_MB, JUDGE_COMPILE_CPU_S, JUDGE_COMPILE_FSIZE)
            compiled_ok = (not comp["timed_out"]) and comp["returncode"] == 0
            if not compiled_ok:
                if comp["timed_out"]:
                    msg = f"Compilation timed out (> {JUDGE_COMPILE_TIMEOUT_S:g}s)"
                elif comp["stderr"].strip():
                    msg = comp["stderr"].strip()
                elif comp["returncode"] < 0:
                    msg = "Compiler killed — " + _judge_signal_message(-comp["returncode"], "compiler")
                else:
                    msg = f"Compilation failed (g++ exited with code {comp['returncode']})"
                # No run — every case is an error with the compiler message.
                return _judge_all(cases, "error", msg[:JUDGE_MSG_LIMIT])
            run_argv = [os.path.join(workdir, "bin")]
        else:  # python
            with open(os.path.join(workdir, "main.py"), "w", encoding="utf-8") as f:
                f.write(req.source)
            run_argv = ["python3", "main.py"]

        results = []
        for c in cases:
            if (time.perf_counter() - request_start) > JUDGE_TOTAL_TIMEOUT_S:
                results.append({
                    "seq": c.seq, "verdict": "error",
                    "message": "Judge total time budget exceeded; case not run."})
                continue
            r = _judge_run_once(
                run_argv, c.input, workdir, JUDGE_RUN_TIMEOUT_S,
                JUDGE_MEM_LIMIT_MB, JUDGE_CPU_LIMIT_S, JUDGE_OUTPUT_LIMIT)
            results.append(_judge_classify(c, r))
        return {"results": results}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/failures")
async def failures(limit: int = 20):
    """Count of logged failures + the most recent few — so we can see the escape
    hatch collecting real usage data."""
    if not os.path.exists(FAILURE_LOG):
        return {"count": 0, "recent": []}
    try:
        with open(FAILURE_LOG, 'r', encoding='utf-8') as f:
            lines = [ln for ln in f if ln.strip()]
        recent = []
        for ln in lines[-limit:]:
            try:
                r = json.loads(ln)
                r['source'] = r.get('source', '')[:300]  # trim for the summary view
                recent.append(r)
            except json.JSONDecodeError:
                continue
        return {"count": len(lines), "recent": recent}
    except Exception as e:
        return {"count": 0, "recent": [], "error": str(e)}
