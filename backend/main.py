from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone
import json
import os
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
