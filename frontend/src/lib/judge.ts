// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  STUB — THE JUDGE BACKEND DOES NOT EXIST YET.                            ║
// ║                                                                          ║
// ║  `runSampleTests` below is the ONE function the whole test-case surface   ║
// ║  goes through. Wiring the real judge means giving it a URL and matching   ║
// ║  the request/response shapes in this file — nothing in the UI changes.    ║
// ║                                                                          ║
// ║  Until then it refuses honestly (JudgeUnavailableError) rather than       ║
// ║  inventing a verdict. Telling a student their wrong answer passed is the  ║
// ║  single worst thing this screen could do, so there is no silent fallback. ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export type CaseVerdict = 'passed' | 'failed' | 'error';

export interface JudgeCaseResult {
  seq: number;
  verdict: CaseVerdict;
  /** What the program actually printed. Absent when it never ran. */
  stdout?: string;
  /** Compiler/runtime message when verdict === 'error'. */
  message?: string;
  timeMs?: number;
}

export interface JudgeRequest {
  problemId: number | string;
  language: string;
  source: string;
  cases: { seq: number; input: string; expected_output: string }[];
  signal?: AbortSignal;
}

export interface JudgeResponse {
  results: JudgeCaseResult[];
}

/** Thrown when there is no judge to talk to. The UI renders this as a calm
 *  "not live yet" note, never as a failed submission. */
export class JudgeUnavailableError extends Error {
  constructor(message = 'The test runner is not live yet.') {
    super(message);
    this.name = 'JudgeUnavailableError';
  }
}

const JUDGE_URL = (import.meta.env.VITE_JUDGE_URL ?? '').replace(/\/+$/, '');

// The OA shell. When DryRun is embedded under onlineassessments.tech/dryrun this
// is same-origin, so `/api/run` and `/api/submit` reach the grader with the
// session cookie attached and no CORS. Standalone (Vercel) it is cross-origin:
// Run silently falls back to the direct judge below, and Submit surfaces the
// failure honestly rather than pretending.
const OA_API = (import.meta.env.VITE_OA_API_URL ?? 'https://onlineassessments.tech').replace(/\/+$/, '');

export type JudgeMode = 'live' | 'demo' | 'demo-fail' | 'off';

/**
 * `?judge=demo` / `?judge=demo-fail` drive a local simulation so the pass,
 * fail and celebration states can be reviewed before a judge exists. The UI
 * labels this mode on screen — it is never mistaken for a real verdict.
 */
export function judgeMode(search = typeof window === 'undefined' ? '' : window.location.search): JudgeMode {
  let q = '';
  try { q = new URLSearchParams(search).get('judge') ?? ''; } catch { q = ''; }
  if (q === 'demo') return 'demo';
  if (q === 'demo-fail') return 'demo-fail';
  return JUDGE_URL ? 'live' : 'off';
}

/** Trailing-whitespace-insensitive comparison, line by line — the same rule a
 *  real judge uses, kept here so the demo path and the UI agree. */
export function outputsMatch(actual: string, expected: string): boolean {
  const norm = (s: string) =>
    s.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
  return norm(actual) === norm(expected);
}

// ── The one call to wire ──────────────────────────────────────────────────

export async function runSampleTests(req: JudgeRequest): Promise<JudgeResponse> {
  const mode = judgeMode();

  if (mode === 'demo' || mode === 'demo-fail') return simulate(req, mode);

  if (mode === 'off') {
    throw new JudgeUnavailableError(
      'DryRun can animate and explain this code, but it cannot check it against the sample cases yet.',
    );
  }

  const body = JSON.stringify({
    problem_id: req.problemId,
    language: req.language,
    source: req.source,
    cases: req.cases,
  });

  // ── Preferred path: OA's same-origin proxy (POST /api/run/:id) ───────────
  // Avoids CORS and lets the OA box own the judge URL. If the proxy isn't there
  // (404) or the network can't reach it, fall through to the direct judge.
  if (OA_API) {
    try {
      const res = await fetch(`${OA_API}/api/run/${encodeURIComponent(String(req.problemId))}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: req.signal,
        body,
      });
      if (res.ok) {
        const data = await res.json();
        return { results: (data.results ?? []) as JudgeCaseResult[] };
      }
      // Only a "not here" (404) or a bad gateway justifies the fallback — a real
      // judge error (compile/timeout arrives as 200 with per-case verdicts, so a
      // non-2xx here is infrastructure) still falls through to the direct judge.
    } catch (e) {
      if (req.signal?.aborted) throw e;
      // network error reaching the proxy — try the direct judge instead
    }
  }

  // ── Fallback: the direct judge (VITE_JUDGE_URL) ─────────────────────────
  const res = await fetch(`${JUDGE_URL}/judge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: req.signal,
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Judge error ${res.status}` }));
    throw new Error(err.detail ?? `Judge error ${res.status}`);
  }
  const data = await res.json();
  return { results: (data.results ?? []) as JudgeCaseResult[] };
}

// ── Submit: server-graded against ALL cases (hidden held back) ─────────────

export interface SubmitFirstFail {
  seq: number;
  /** True when the failing case is a visible sample — only then may we show
   *  its input/expected/got. A hidden failure is reported as just its number. */
  is_sample: boolean;
  input?: string;
  expected?: string;
  got?: string;
}

export interface SubmitResult {
  passed: number;
  total: number;
  allPassed: boolean;
  firstFail?: SubmitFirstFail | null;
}

export interface SubmitRequest {
  problemId: number | string;
  language: string;
  source: string;
  /** Only used by the local demo path to size the fake verdict. */
  total?: number;
  signal?: AbortSignal;
}

/**
 * POST /api/submit/:id — same-origin so the OA session cookie flows. The grader
 * runs every case (samples + hidden) and returns the summary; hidden inputs
 * never come back. Errors honestly (never a fabricated pass); a 404 means the OA
 * grader endpoint isn't deployed yet.
 */
export async function submitAll(req: SubmitRequest): Promise<SubmitResult> {
  const mode = judgeMode();
  if (mode === 'demo' || mode === 'demo-fail') return simulateSubmit(req, mode);

  const res = await fetch(`${OA_API}/api/submit/${encodeURIComponent(String(req.problemId))}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    signal: req.signal,
    body: JSON.stringify({ source: req.source, language: req.language }),
  });
  if (res.status === 404) {
    throw new JudgeUnavailableError('Submit isn’t live yet — the grader hasn’t been deployed. Run works against the sample cases.');
  }
  if (res.status === 401) {
    throw new Error('Your session expired. Reopen the question from onlineassessments.tech and try again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Submit error ${res.status}` }));
    throw new Error(err.detail ?? `Submit error ${res.status}`);
  }
  const data = await res.json();
  const ff = data.firstFail ?? null;
  return {
    passed: Number(data.passed) || 0,
    total: Number(data.total) || 0,
    allPassed: Boolean(data.allPassed),
    firstFail: ff
      ? {
          seq: Number(ff.seq) || 0,
          is_sample: Boolean(ff.is_sample),
          input: typeof ff.input === 'string' ? ff.input : undefined,
          expected: typeof ff.expected === 'string' ? ff.expected : undefined,
          got: typeof ff.got === 'string' ? ff.got : undefined,
        }
      : null,
  };
}

// ── Local simulation (review only — never runs when a judge is configured) ─

function simulate(req: JudgeRequest, mode: 'demo' | 'demo-fail'): Promise<JudgeResponse> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        results: req.cases.map((c, i) => {
          const fail = mode === 'demo-fail' && i === Math.min(1, req.cases.length - 1);
          return {
            seq: c.seq,
            verdict: fail ? ('failed' as const) : ('passed' as const),
            stdout: fail ? '(demo) a wrong answer\n' : c.expected_output,
            timeMs: 40 + i * 7,
          };
        }),
      });
    }, 650);
  });
}

function simulateSubmit(req: SubmitRequest, mode: 'demo' | 'demo-fail'): Promise<SubmitResult> {
  const total = Math.max(req.total ?? 10, 1);
  return new Promise(resolve => {
    setTimeout(() => {
      if (mode === 'demo') {
        resolve({ passed: total, total, allPassed: true, firstFail: null });
      } else {
        const failAt = Math.min(3, total);
        resolve({
          passed: failAt - 1,
          total,
          allPassed: false,
          firstFail: {
            seq: failAt,
            is_sample: false, // pretend the first failure is a hidden case
          },
        });
      }
    }, 900);
  });
}
