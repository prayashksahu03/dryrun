import { useCallback, useEffect, useRef, useState } from 'react';
import { useExecutionStore } from '../../store/executionStore';
import { OATestCase } from '../../types/problem';
import {
  JudgeCaseResult, JudgeUnavailableError, SubmitResult,
  judgeMode, runSampleTests, submitAll,
} from '../../lib/judge';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// The feedback loop the solve page was missing — now with the two distinct
// LeetCode gestures:
//
//   • RUN     → the VISIBLE sample cases, with full per-case detail (input,
//               your output, expected, pass/fail, time). Fast, local reference.
//   • SUBMIT  → server-graded against ALL cases (samples + hidden). Returns a
//               summary (8/10) and the FIRST failure; a hidden failure is shown
//               as just its number, never its input/output. All-pass fires the
//               celebration and marks the problem Solved.
//
// Every verdict comes from lib/judge.ts and nowhere else. When there is no judge
// configured the panel says so plainly and stays useful as a reference list; it
// never fabricates a pass. Both buttons disable while either is in flight.

type RunState = 'idle' | 'running' | 'done' | 'error';
type SubmitState = 'idle' | 'submitting' | 'done' | 'error';

export interface PassInfo { passed: number; total: number; attempts: number }

const MARK: Record<string, { glyph: string; cls: string; word: string }> = {
  passed:  { glyph: '✓', cls: 'text-green-400', word: 'Passed' },
  failed:  { glyph: '✕', cls: 'text-rose-400',  word: 'Failed' },
  error:   { glyph: '!', cls: 'text-amber-400', word: 'Error' },
  pending: { glyph: '·', cls: 'text-zinc-600',  word: '' },
};

// A quiet inline spinner. Reduced motion gets a static glyph — same meaning,
// no movement.
function Spinner({ reduced }: { reduced: boolean }) {
  if (reduced) return <span aria-hidden className="inline-block">◍</span>;
  return (
    <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" className="animate-spin inline-block">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function TestRunner({
  cases, problemId, totalCases, onSolved,
}: {
  cases: OATestCase[];
  problemId: number | string;
  /** How many cases Submit grades against (samples + hidden). */
  totalCases?: number | null;
  /** Fired only when SUBMIT reports every case passed. */
  onSolved: (info: PassInfo) => void;
}) {
  const editorSource = useExecutionStore(s => s.editorSource);
  const language = useExecutionStore(s => s.language);
  const setStdinInput = useExecutionStore(s => s.setStdinInput);
  const reduced = useReducedMotion();

  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  // ── Run (sample cases) ────────────────────────────────────────────────
  const [runState, setRunState] = useState<RunState>('idle');
  const [results, setResults] = useState<JudgeCaseResult[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const [runUnavailable, setRunUnavailable] = useState(false);
  const [washing, setWashing] = useState(false);

  // ── Submit (all cases, server-graded) ─────────────────────────────────
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitUnavailable, setSubmitUnavailable] = useState(false);
  const submitAttempts = useRef(0);

  const timers = useRef<number[]>([]);
  const runAbort = useRef<AbortController | null>(null);
  const submitAbort = useRef<AbortController | null>(null);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => {
    clearTimers();
    runAbort.current?.abort();
    submitAbort.current?.abort();
  }, []);

  const mode = judgeMode();
  const judgeOff = mode === 'off';
  const demo = mode === 'demo' || mode === 'demo-fail';
  const busy = runState === 'running' || submitState === 'submitting';

  // A code edit invalidates the last verdict — a stale green row is a lie.
  useEffect(() => {
    setRunState('idle'); setResults([]); setRevealed(0); setRunError(null);
    setRunUnavailable(false); setWashing(false); setExpanded(null);
    setSubmitState('idle'); setSubmitResult(null); setSubmitError(null); setSubmitUnavailable(false);
    clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSource]);

  const run = useCallback(async () => {
    clearTimers();
    runAbort.current?.abort();
    const ctrl = new AbortController();
    runAbort.current = ctrl;

    setRunState('running'); setResults([]); setRevealed(0);
    setRunError(null); setRunUnavailable(false); setExpanded(null); setWashing(false);

    try {
      const res = await runSampleTests({
        problemId,
        language,
        source: editorSource,
        cases: cases.map((c, i) => ({ seq: c.seq ?? i, input: c.input, expected_output: c.expected_output })),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;

      setResults(res.results);
      setRunState('done');

      const allPassed = res.results.length > 0 && res.results.every(r => r.verdict === 'passed');

      // The rows flip one at a time — the small build-up is the whole point of
      // the beat. Reduced motion gets the same information instantly.
      const step = reduced ? 0 : 130;
      if (step === 0) {
        setRevealed(res.results.length);
      } else {
        res.results.forEach((_, i) => {
          timers.current.push(window.setTimeout(() => setRevealed(i + 1), i * step));
        });
        if (allPassed) {
          timers.current.push(window.setTimeout(() => {
            setWashing(true);
            timers.current.push(window.setTimeout(() => setWashing(false), 900));
          }, res.results.length * step + 80));
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (e instanceof JudgeUnavailableError) {
        setRunUnavailable(true); setRunError(e.message); setRunState('error');
      } else {
        setRunError(e instanceof Error ? e.message : String(e)); setRunState('error');
      }
    }
  }, [cases, editorSource, language, problemId, reduced]);

  const submit = useCallback(async () => {
    submitAbort.current?.abort();
    const ctrl = new AbortController();
    submitAbort.current = ctrl;

    submitAttempts.current += 1;
    setSubmitState('submitting'); setSubmitResult(null);
    setSubmitError(null); setSubmitUnavailable(false);

    try {
      const res = await submitAll({
        problemId,
        language,
        source: editorSource,
        total: totalCases ?? cases.length,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;

      setSubmitResult(res);
      setSubmitState('done');

      if (res.allPassed) {
        if (!reduced) {
          setWashing(true);
          timers.current.push(window.setTimeout(() => setWashing(false), 900));
        }
        onSolved({ passed: res.passed, total: res.total, attempts: submitAttempts.current });
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (e instanceof JudgeUnavailableError) {
        setSubmitUnavailable(true); setSubmitError(e.message); setSubmitState('error');
      } else {
        setSubmitError(e instanceof Error ? e.message : String(e)); setSubmitState('error');
      }
    }
  }, [cases.length, editorSource, language, problemId, reduced, totalCases, onSolved]);

  const byIndex = (i: number): JudgeCaseResult | null =>
    (runState === 'done' && i < revealed ? results[i] ?? null : null);

  const passedCount = results.filter(r => r.verdict === 'passed').length;
  const shown = runState === 'done' ? Math.min(revealed, results.length) : 0;
  const runAllPassedNow = runState === 'done' && shown === results.length && results.length > 0 && passedCount === results.length;
  const submitAllPassed = submitState === 'done' && Boolean(submitResult?.allPassed);
  const glow = runAllPassedNow || submitAllPassed;

  const judgeCount = totalCases ?? cases.length;

  return (
    <div className="flex-shrink-0 border-t border-zinc-800/60 bg-[#0d0d0f] flex flex-col max-h-[46%]">
      {/* Header — also the tier-1 celebration surface: one green wash, no overlay. */}
      <div className={`relative overflow-hidden flex items-center gap-2 h-9 px-3 flex-shrink-0 border-b border-zinc-800/60 transition-colors ${
        glow ? 'bg-green-400/[0.06]' : 'bg-[#111113]'
      } ${washing && !reduced ? 'dr-anim dr-wash' : ''}`}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <span className={`text-[8px] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▶</span>
          Test cases
          <span className="text-zinc-600 normal-case tracking-normal">{cases.length}</span>
        </button>

        {/* Verdict summary — Submit's answer wins (it graded everything); Run's
            sample tally shows only until a Submit result exists. Held back until
            every Run row has flipped, so the number and the rows never disagree. */}
        {submitState === 'done' && submitResult ? (
          <span className={`h-[20px] inline-flex items-center px-2 rounded text-[10px] font-mono border ${
            submitResult.allPassed
              ? 'text-green-400 bg-green-400/10 border-green-400/30'
              : 'text-rose-400 bg-rose-400/10 border-rose-400/30'
          }`}>
            {submitResult.passed}/{submitResult.total} passed
          </span>
        ) : runState === 'done' && shown === results.length ? (
          <span className={`h-[20px] inline-flex items-center px-2 rounded text-[10px] font-mono border ${
            runAllPassedNow
              ? 'text-green-400 bg-green-400/10 border-green-400/30'
              : 'text-rose-400 bg-rose-400/10 border-rose-400/30'
          }`}>
            {passedCount}/{results.length} samples
          </span>
        ) : null}
        {runState === 'running' && (
          <span className="text-[10px] font-mono text-violet-300/80 inline-flex items-center gap-1.5"><Spinner reduced={reduced} /> running…</span>
        )}
        {submitState === 'submitting' && (
          <span className="text-[10px] font-mono text-violet-300/80 inline-flex items-center gap-1.5">
            <Spinner reduced={reduced} /> {judgeCount ? `judging ${judgeCount} tests…` : 'submitting…'}
          </span>
        )}
        {demo && (
          <span
            className="h-[20px] inline-flex items-center px-1.5 rounded text-[9px] font-mono text-amber-400 bg-amber-400/10 border border-amber-400/30"
            title="Verdicts are simulated locally for design review — not a real judge."
          >
            demo judge
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={run}
            disabled={busy || judgeOff}
            title={judgeOff ? 'The test runner is not live yet' : 'Run your code against the visible sample cases'}
            className={`h-6 px-2.5 rounded text-[11px] font-mono font-medium border transition-colors inline-flex items-center gap-1.5 ${
              judgeOff
                ? 'text-zinc-600 border-zinc-800 cursor-not-allowed'
                : runState === 'running'
                  ? 'bg-zinc-800/60 text-violet-300 border-zinc-700 cursor-wait'
                  : busy
                    ? 'text-zinc-600 border-zinc-800 cursor-not-allowed'
                    : 'bg-zinc-800/70 text-zinc-200 border-zinc-700 hover:bg-zinc-700/70 hover:border-zinc-600'
            }`}
          >
            {runState === 'running' ? <><Spinner reduced={reduced} /> Running…</> : '▶ Run'}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || judgeOff}
            title={judgeOff ? 'The judge is not live yet' : 'Submit against all tests (including hidden)'}
            className={`h-6 px-2.5 rounded text-[11px] font-mono font-semibold border transition-colors inline-flex items-center gap-1.5 ${
              judgeOff
                ? 'text-zinc-600 border-zinc-800 cursor-not-allowed'
                : submitState === 'submitting'
                  ? 'bg-violet-500/20 text-violet-300 border-violet-500/30 cursor-wait'
                  : busy
                    ? 'text-zinc-600 border-zinc-800 cursor-not-allowed'
                    : 'bg-violet-500/25 text-violet-200 border-violet-500/40 hover:bg-violet-500/40 hover:border-violet-500/60'
            }`}
          >
            {submitState === 'submitting'
              ? <><Spinner reduced={reduced} /> {judgeCount ? `Judging ${judgeCount}…` : 'Submitting…'}</>
              : '⏎ Submit'}
          </button>
        </div>
      </div>

      {open && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Honest note when there is nothing to run against. The cases below
              stay useful as a reference list either way. */}
          {judgeOff && (
            <p className="px-3 py-2 text-[10.5px] font-mono text-zinc-500 border-b border-zinc-800/50 leading-relaxed">
              The test runner isn’t live yet. Load a case into stdin, hit Run in the editor, and compare with
              the expected output — the animation and tutor work on it today.
            </p>
          )}

          {/* Submit verdict — the summary of the whole grade, and the first
              failure. A hidden failure is shown as just its number. */}
          {submitState === 'done' && submitResult && (
            <SubmitSummary result={submitResult} />
          )}

          {submitState === 'error' && (
            <p className={`px-3 py-2 text-[10.5px] font-mono border-b leading-relaxed ${
              submitUnavailable
                ? 'text-amber-300/90 border-amber-500/20 bg-amber-500/[0.06]'
                : 'text-rose-300/90 border-rose-500/20 bg-rose-500/[0.06]'
            }`}>
              {submitError}
            </p>
          )}

          {runState === 'error' && !runUnavailable && (
            <p className="px-3 py-2 text-[10.5px] font-mono text-rose-300/90 border-b border-rose-500/20 bg-rose-500/[0.06] leading-relaxed">
              {runError}
            </p>
          )}

          <ul className="py-1">
            {cases.map((c, i) => {
              const r = byIndex(i);
              const m = MARK[r?.verdict ?? 'pending'] ?? MARK.pending;
              const isOpen = expanded === i;
              return (
                <li key={c.id ?? i} className="px-1.5">
                  <div className={`flex items-center gap-2.5 pr-2 rounded-md transition-colors ${
                    r?.verdict === 'passed' ? 'bg-green-400/[0.07]' :
                    r?.verdict === 'failed' ? 'bg-rose-400/[0.06]'  :
                    r?.verdict === 'error'  ? 'bg-amber-400/[0.06]' : 'hover:bg-zinc-800/40'
                  }`}>
                    <button
                      type="button"
                      onClick={() => setExpanded(o => (o === i ? null : i))}
                      aria-expanded={isOpen}
                      className="flex-1 min-w-0 flex items-center gap-2.5 px-2 py-1.5 text-left"
                    >
                      <span className={`w-3 text-center font-mono text-[11px] ${m.cls}`} aria-hidden>{m.glyph}</span>
                      <span className="font-mono text-[11px] text-zinc-400">Case {i + 1}</span>
                      {m.word && <span className={`font-mono text-[10px] ${m.cls}`}>{m.word}</span>}
                      {typeof r?.timeMs === 'number' && (
                        <span className="font-mono text-[9.5px] text-zinc-600 tabular-nums">{r.timeMs} ms</span>
                      )}
                      <span className={`ml-auto text-[8px] text-zinc-600 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setStdinInput(c.input)}
                      className="flex-shrink-0 font-mono text-[9px] text-zinc-600 hover:text-violet-300 px-1.5 py-1 rounded transition-colors"
                      title="Put this case's input into the editor's stdin panel"
                    >
                      → stdin
                    </button>
                  </div>

                  {isOpen && (
                    <div className="grid gap-2 px-2 pb-2.5 pt-1">
                      <Snippet label="Input" value={c.input} tone="neutral" />
                      <Snippet label="Expected" value={c.expected_output} tone="good" />
                      {r && r.verdict !== 'passed' && (
                        <Snippet
                          label={r.verdict === 'error' ? 'Error' : 'Your output'}
                          value={(r.verdict === 'error' ? r.message : r.stdout) ?? '(nothing)'}
                          tone="bad"
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// The Submit verdict: the tally, then the first failure. A sample failure shows
// its input / expected / got; a hidden failure is reported as just its number —
// the hidden case's data is never sent to the client, so there is nothing to leak.
function SubmitSummary({ result }: { result: SubmitResult }) {
  if (result.allPassed) {
    return (
      <div className="px-3 py-2.5 border-b border-green-500/20 bg-green-400/[0.06]">
        <div className="flex items-center gap-2 text-[11.5px] font-mono text-green-300">
          <span aria-hidden>✓</span>
          <span className="font-semibold">Accepted</span>
          <span className="text-green-400/80">· {result.passed}/{result.total} tests passed</span>
        </div>
      </div>
    );
  }
  const ff = result.firstFail ?? null;
  return (
    <div className="px-3 py-2.5 border-b border-rose-500/20 bg-rose-400/[0.05]">
      <div className="flex items-center gap-2 text-[11.5px] font-mono text-rose-300">
        <span aria-hidden>✕</span>
        <span className="font-semibold">{result.passed}/{result.total} tests passed</span>
      </div>
      {ff && (
        <div className="mt-2">
          <div className="text-[10px] font-mono text-rose-300/80 mb-1.5">
            Test {ff.seq} failed{ff.is_sample ? ' (sample)' : ' (hidden)'}
          </div>
          {ff.is_sample ? (
            <div className="grid gap-2">
              {ff.input !== undefined && <Snippet label="Input" value={ff.input} tone="neutral" />}
              {ff.expected !== undefined && <Snippet label="Expected" value={ff.expected} tone="good" />}
              {ff.got !== undefined && <Snippet label="Your output" value={ff.got} tone="bad" />}
            </div>
          ) : (
            <p className="text-[10.5px] font-mono text-zinc-500 leading-relaxed">
              This is a hidden test — its input and expected output aren’t shown. Re-read the constraints and edge cases, then submit again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Snippet({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'good' | 'bad' }) {
  const cls =
    tone === 'good' ? 'border-green-400/15 bg-green-400/[0.04] text-green-300/90'
    : tone === 'bad' ? 'border-rose-400/20 bg-rose-400/[0.05] text-rose-200/90'
    : 'border-zinc-800/70 bg-[#08080a] text-zinc-300';
  return (
    <div>
      <div className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-600 mb-1">{label}</div>
      <pre className={`max-h-32 overflow-auto rounded px-2 py-1.5 text-[11px] font-mono leading-relaxed whitespace-pre border ${cls}`}>
        {value.replace(/\n+$/, '') || ' '}
      </pre>
    </div>
  );
}
