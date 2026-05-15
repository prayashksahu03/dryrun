from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from interpreter.interpreter import CInterpreter
from interpreter.cpp_interpreter import CppInterpreter
from interpreter.python_tracer import PythonTracer

app = FastAPI(title="MemTrace Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ExecuteRequest(BaseModel):
    source: str
    language: str = 'c'   # 'c' | 'cpp' | 'python'
    stdin_input: str = ''

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
            return {"trace": trace, "source": req.source}

        if lang in ('cpp', 'c++'):
            interp = CppInterpreter(req.source, stdin_data=req.stdin_input)
        else:
            interp = CInterpreter(req.source)

        trace = interp.run()
        return {"trace": trace, "source": req.source}

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Interpreter error: {str(e)}")


@app.get("/health")
async def health():
    return {"status": "ok"}
