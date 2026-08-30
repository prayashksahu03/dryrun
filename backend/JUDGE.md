# `/judge` — sandboxed test-case runner

A LeetCode-style Run/Submit judge for DryRun. It compiles (C++) and runs
**untrusted student code** against a list of test cases inside an OS resource
sandbox, and returns a per-case verdict. The LLM is never in this path.

- Endpoint: `POST /judge` (defined in `backend/main.py`)
- Requires `g++` in the image (added to `backend/Dockerfile`).
- Supported languages today: `cpp` (aliases `c++`) and `python` (alias `py`).

---

## Contract (matches `frontend/src/lib/judge.ts` byte-for-byte)

### Request body

The frontend (`runSampleTests`) posts **snake_case** keys:

```json
{
  "problem_id": 1,
  "language": "cpp",
  "source": "#include <bits/stdc++.h>\n...",
  "cases": [
    { "seq": 1, "input": "2 3\n", "expected_output": "5" },
    { "seq": 2, "input": "10 20\n", "expected_output": "30" }
  ]
}
```

- `problem_id` — `number | string`, accepted and currently unused.
- `language` — `"cpp"` / `"python"` (case-insensitive). Anything else ⇒ a clean
  per-case `error` result, **never** a 500.
- `source` — the program text.
- `cases[]` — `{ seq, input, expected_output }`. `input` is fed on **stdin**.

### Response body

```json
{
  "results": [
    { "seq": 1, "verdict": "passed", "stdout": "5\n", "timeMs": 59 },
    { "seq": 2, "verdict": "failed", "stdout": "6\n", "timeMs": 10 }
  ]
}
```

- `verdict` — `"passed" | "failed" | "error"`.
- `stdout` — present on `passed`/`failed` (what the program actually printed;
  capped at 64 KB). Absent when the program never ran.
- `message` — present on `error` (compiler message / timeout / signal). Absent
  otherwise.
- `timeMs` — integer wall-clock milliseconds. **camelCase**, as the UI expects.

### Verdict rules

1. **Compile once** (C++): `g++ -std=c++17 -O2 -o bin src.cpp` in a fresh temp
   dir. If compilation fails or times out, **every** case is `error` with the
   g++ message (truncated to ~2 KB) — nothing is run.
2. Per case: run the binary/script with the case `input` on stdin, capture
   stdout, and compare to `expected_output`.
3. Comparison mirrors the frontend `outputsMatch`: CRLF→LF, right-strip each
   line, strip trailing newlines, then exact-equal ⇒ `passed`, else `failed`
   (with the actual `stdout`).
4. A timeout, a kill-by-signal, or a non-zero exit code ⇒ `error` (with the
   cause in `message`). Runtime error results always carry `timeMs`.

---

## Sandbox limits

Every execution runs under an OS resource sandbox applied in a `preexec_fn`
(`setrlimit` in the forked child, before `exec`) plus a wall-clock watchdog in
the parent that **SIGKILLs the whole process group** (`os.setsid()` in the
child, `os.killpg(pgid, SIGKILL)` on timeout — so children are never leaked).
All limits are env-tunable constants near the top of the `/judge` section in
`main.py`.

| Concern | Mechanism | Default | Env var |
|---|---|---|---|
| Cases per request | slice | 50 | `JUDGE_MAX_CASES` |
| Source length | length check | 64,000 chars | `JUDGE_MAX_SOURCE_LEN` |
| Per-run wall clock | watchdog + `killpg` | 5 s | `JUDGE_RUN_TIMEOUT_S` |
| Compile wall clock | watchdog + `killpg` | 10 s | `JUDGE_COMPILE_TIMEOUT_S` |
| Whole-request wall clock | budget check between cases | 30 s | `JUDGE_TOTAL_TIMEOUT_S` |
| Per-run memory | `RLIMIT_AS` | 256 MB | `JUDGE_MEM_LIMIT_MB` |
| Compile memory | `RLIMIT_AS` on g++ | 768 MB | `JUDGE_COMPILE_MEM_MB` |
| Per-run CPU | `RLIMIT_CPU` (SIGXCPU→SIGKILL) | 5 s | `JUDGE_CPU_LIMIT_S` |
| Compile CPU | `RLIMIT_CPU` on g++ | 10 s | `JUDGE_COMPILE_CPU_S` |
| Output size | `RLIMIT_FSIZE` (SIGXFSZ) + read cap | 64 KB | `JUDGE_OUTPUT_LIMIT` |
| Compiled-binary size | `RLIMIT_FSIZE` on g++ | 64 MB | `JUDGE_COMPILE_FSIZE` |
| Message size | truncation | 2,048 bytes | `JUDGE_MSG_LIMIT` |
| Process count | `RLIMIT_NPROC` | 64 | `JUDGE_NPROC_LIMIT` |
| Core dumps | `RLIMIT_CORE` = 0 | — | — |
| Privilege escalation | `prctl(PR_SET_NO_NEW_PRIVS)` (best-effort) | on | — |
| Secret isolation | child env is a minimal PATH/LANG/HOME — **not** `os.environ` | — | — |

Implementation notes:

- **stdin/stdout/stderr are files**, not pipes — so there is no pipe deadlock
  and the parent never buffers unbounded output in memory. `RLIMIT_FSIZE`
  caps the stdout file, so a `while(1) printf` dies with `SIGXFSZ` at 64 KB.
- The `/judge` handler is a **sync** `def`, so FastAPI runs it in a threadpool;
  the blocking subprocess/watchdog work never stalls the async event loop.
- Student code gets a **scrubbed env** (`PATH`, `LANG`, `LC_ALL`, `HOME` only).
  This is deliberate: `os.environ` holds the LLM API keys, and they must never
  reach untrusted code.

### Network isolation — important, given this is Render not Piston

Render's container is the outer boundary (the accepted tradeoff vs a separate
Piston VPS). **The judge does not, and on Render cannot without namespaces,
block outbound network from student code.** Containment here rests on:

- the 5 s wall-clock timeout + process-group SIGKILL (a network call that hangs
  is killed with everything else), and
- the isolated, ephemeral Render dyno being the trust boundary.

The judge itself adds nothing that reaches the network.

### Root & `RLIMIT_NPROC` (verified caveat)

The image runs as **root** (the existing container user; no `USER` line, per the
brief). Root holds `CAP_SYS_RESOURCE`, so the kernel **does not enforce
`RLIMIT_NPROC` for root** — a probe confirmed 300 `fork()` calls all succeed
inside the sandbox. Fork-bomb containment therefore currently rests entirely on
the **wall-clock timeout + `killpg`**, which is proven below (after the run,
process count returns to baseline and the server stays healthy). The
`RLIMIT_NPROC` limit is left in place because it becomes effective the moment
the container is switched to a non-root user — a one-line `USER` addition to the
Dockerfile is the recommended defense-in-depth hardening if a stricter pid cap
is wanted.

---

## Local Docker test transcript

Real Render environment is Linux; this Mac's Apple clang can't do
`bits/stdc++.h`, so everything below was run against the built image:

```
docker build -t dryrun-judge backend/
docker run -d --name dryrun-judge-test -p 18010:8000 dryrun-judge
```

`g++ (Debian 14.2.0-19) 14.2.0`, `GET /health` → `200 {"status":"ok"}`.

### 1. Correct C++ → all `passed`

```
POST /judge  language=cpp  source: reads a,b; prints a+b
{"results":[
  {"seq":1,"verdict":"passed","stdout":"5\n","timeMs":59},
  {"seq":2,"verdict":"passed","stdout":"30\n","timeMs":7}
]}
```

### 2. Wrong-output C++ → `failed` with the actual stdout

```
source prints a*b instead of a+b; expected "5"
{"results":[
  {"seq":1,"verdict":"failed","stdout":"6\n","timeMs":10}
]}
```

### 3. Compile error → all `error` with the g++ message

```
source: int a = ;  (syntax error), 2 cases
{"results":[
  {"seq":1,"verdict":"error","message":"src.cpp: In function 'int main()':\nsrc.cpp:2:21: error: expected primary-expression before ';' token\n    2 | int main(){ int a = ; return 0 }\n      |                     ^\nsrc.cpp:2:31: error: expected ';' before '}' token\n..."},
  {"seq":2,"verdict":"error","message":"src.cpp: In function 'int main()':\n...(same g++ message)..."}
]}
```

Both cases carry the compiler message; nothing was executed.

### 4. Infinite loop `while(1){}` → timeout, process actually killed

```
{"results":[
  {"seq":1,"verdict":"error","message":"Time limit exceeded (> 5s)","timeMs":5030}
]}
```

Cleanup verified via `/proc`: baseline 5 procs → during a fork-bomb run the tree
spikes → 2 s after the request returns, process count is back to baseline
(only `uvicorn` + the inspecting shell). No `bin` children leaked.

### 5. Memory bomb `vector<int> v(1<<30)` → bounded, server survives

```
{"results":[
  {"seq":1,"verdict":"error","message":"Runtime error: aborted (SIGABRT) — often an uncaught exception or bad_alloc\nterminate called after throwing an instance of 'std::bad_alloc'\n  what():  std::bad_alloc","timeMs":39}
]}
GET /health after → 200
```

`RLIMIT_AS` (256 MB) turns the 4 GB allocation into `bad_alloc`; the server is
never OOM-killed.

### 6. Fork bomb `while(1){fork();}` → contained by time limit + killpg

```
{"results":[
  {"seq":1,"verdict":"error","message":"Time limit exceeded (> 5s)","timeMs":5452}
]}
GET /health after → 200
```

After the request returns, `/proc` shows process count back to baseline — the
process-group SIGKILL reaped the whole tree. (As noted above, `RLIMIT_NPROC`
does not bite while running as root; the timeout + killpg is what contains it.)

### 7. Output flood `while(1) printf(...)` → `SIGXFSZ`, bounded to 64 KB

```
{"results":[
  {"seq":1,"verdict":"error","message":"Output limit exceeded (> 64KB written)","timeMs":...}
]}
GET /health after → 200
```

### 8. Python correct + wrong case

```
source: a,b=map(int,input().split()); print(a+b)
case1 expected "5", case2 expected "999"
{"results":[
  {"seq":1,"verdict":"passed","stdout":"5\n","timeMs":194},
  {"seq":2,"verdict":"failed","stdout":"15\n","timeMs":47}
]}
```

### 9. Unsupported language → clean per-case error (not a 500)

```
language=java
{"results":[
  {"seq":1,"verdict":"error","message":"Unsupported language 'java'. Supported: cpp, python."}
]}
```

### Regression — existing endpoints unaffected

- `POST /execute` (libclang C++ tracer) → `200`, trace produced.
- `POST /execute` (Python tracer) → `200`.
- `GET /health` → `200`; `GET /failures` → `200`.

---

## Image size delta from adding g++

From `docker history` (uncompressed layer sizes):

- **g++ apt layer: ~249 MB** — this is the delta from adding `g++` (pulls in
  `gcc`, `cpp`, `binutils`, and `libstdc++-*-dev` headers).
- For context, the rest of the image: base `python:3.10-slim` ~211 MB, pip deps
  (fastapi/libclang/openai) ~131 MB, app `COPY` ~150 MB.

Aside (pre-existing, not from this change): the 150 MB `COPY . .` layer includes
the local `backend/.venv` and `.env`. Adding a `.dockerignore` for `.venv`,
`__pycache__`, and `.env` would shed most of that and avoid baking secrets into
the image — orthogonal to the judge, worth a follow-up.
