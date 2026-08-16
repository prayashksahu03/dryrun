from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Any, Optional, List
from collections import OrderedDict
import json
import os
import hashlib

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
EXPLAIN_MODEL    = os.getenv("EXPLAIN_MODEL", "qwen2.5-coder:7b")
EXPLAIN_API_KEY  = os.getenv("EXPLAIN_API_KEY", "ollama")  # Ollama ignores it; real key for Groq/etc.

_explain_client = None


def _get_explain_client():
    """Lazy singleton. Returns None if the SDK isn't available so the endpoint
    can degrade gracefully instead of crashing."""
    global _explain_client
    if not _OPENAI_AVAILABLE:
        return None
    if _explain_client is None:
        _explain_client = OpenAI(base_url=EXPLAIN_BASE_URL, api_key=EXPLAIN_API_KEY)
    return _explain_client


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
    resp = client.chat.completions.create(
        model=EXPLAIN_MODEL,
        max_tokens=400,
        temperature=0.2,
        messages=[
            {"role": "system", "content": EXPLAIN_SYSTEM},
            {"role": "user",   "content": _build_facts(req)},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


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
        # Distinguish "provider unreachable" (Ollama down / model not pulled) from other errors,
        # without hard-importing openai's exception classes (SDK may be absent).
        name = type(e).__name__
        if 'Connection' in name or 'Timeout' in name:
            raise HTTPException(
                status_code=503,
                detail="Explain is unavailable — is Ollama running with the model pulled? "
                       "(ollama serve; ollama pull qwen2.5-coder:7b)")
        raise HTTPException(status_code=502, detail=f"LLM error ({name}). Try again.")

    _EXPLAIN_CACHE[key] = text
    _EXPLAIN_CACHE.move_to_end(key)
    while len(_EXPLAIN_CACHE) > _EXPLAIN_CACHE_MAX:
        _EXPLAIN_CACHE.popitem(last=False)
    return ExplainResponse(explanation=text, cached=False, model=EXPLAIN_MODEL)


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
