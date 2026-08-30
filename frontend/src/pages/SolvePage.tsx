import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useExecutionStore } from '../store/executionStore';
import ProblemPanel from '../components/ProblemPanel';
import CodePanel from '../components/CodePanel';
import ToolWorkspace, { ColDivider } from '../components/ToolWorkspace';
import TestRunner, { PassInfo } from '../components/solve/TestRunner';
import SolvedMoment, { SolvedFacts, SolvedTier } from '../components/solve/SolvedMoment';
import { ProblemSkeleton, EditorSkeleton } from '../components/solve/Skeletons';
import { OAProblem, normalizeDifficulty, sampleCases } from '../types/problem';
import { recordSolve, hasSolved } from '../lib/solveTally';

// Where the OA question API lives (the live onlineassessments.tech shell).
const OA_API = (import.meta.env.VITE_OA_API_URL ?? 'https://onlineassessments.tech').replace(/\/+$/, '');

type SolveTab = 'code' | 'animation' | 'tutor' | 'interview';

// The four tabs at the top of a question. "Code" is the LeetCode split (problem
// left, editor right). The other three hide the problem and drop into DryRun's
// existing debug / tutor / interview experience — driven by the same appMode.
const TABS: { key: SolveTab; label: string; mode?: 'debug' | 'tutor' | 'interview' }[] = [
  { key: 'code',      label: 'Code' },
  { key: 'animation', label: 'Animation', mode: 'debug' },
  { key: 'tutor',     label: 'Tutor',     mode: 'tutor' },
  { key: 'interview', label: 'Interview', mode: 'interview' },
];

type Status = 'loading' | 'ok' | 'unauthorized' | 'notfound' | 'error';

export default function SolvePage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get('t') ?? '';
  // A landing page can hand the editor a program: /solve/:id?code=<encoded>.
  // When it does, it wins over the question's starter code.
  const prefill = sp.get('code') ?? '';

  const setAppMode = useExecutionStore(s => s.setAppMode);
  const setProblemStatement = useExecutionStore(s => s.setProblemStatement);
  const setEditorSource = useExecutionStore(s => s.setEditorSource);
  const clearTrace = useExecutionStore(s => s.clearTrace);

  const [problem, setProblem] = useState<OAProblem | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [tab, setTab] = useState<SolveTab>('code');

  // The passing moment. `solved` is sticky (the top-bar pill); `moment` is the
  // transient card and is only ever set as the direct consequence of a run.
  const [solved, setSolved] = useState(false);
  const [moment, setMoment] = useState<SolvedFacts | null>(null);
  const openedAt = useRef<number>(Date.now());

  // Split between problem (left) and editor (right) on the Code tab.
  const [leftPct, setLeftPct] = useState(42);
  const containerRef = useRef<HTMLDivElement>(null);
  const totalWidth = () => containerRef.current?.getBoundingClientRect().width ?? 1;

  // Fetch the question from the OA read-only API using the door token.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    if (!id) { setStatus('notfound'); return; }
    fetch(`${OA_API}/api/problem/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`)
      .then(async res => {
        if (cancelled) return;
        if (res.status === 401) { setStatus('unauthorized'); return; }
        if (res.status === 404) { setStatus('notfound'); return; }
        if (!res.ok) { setStatus('error'); return; }
        const data = (await res.json()) as OAProblem;
        setProblem(data);
        setStatus('ok');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [id, token]);

  // Once loaded: ground the tutor/interview in this problem, and seed the editor.
  // Imported questions carry a real `starter_code` stub — that is what the
  // student expects to see. Everything else falls back to the neutral skeleton
  // this page has always used. Done once per problem.
  useEffect(() => {
    if (status !== 'ok' || !problem) return;
    const statement = problem.statement_md?.trim() || problem.text?.trim() || '';
    setProblemStatement(`${problem.title}\n\n${statement}`.trim());
    const starter = problem.starter_code?.trim();
    setEditorSource(
      prefill.trim()
        ? prefill
        : starter
          ? `${starter}\n`
          : `// ${problem.title}\n// Write your solution below, then Run.\n\n`,
    );
    clearTrace();
    setAppMode('debug');
    openedAt.current = Date.now();
    setSolved(hasSolved(problem.id));
    setMoment(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, problem]);

  // Clear the grounding when leaving the solve page (so /app is free-practice again).
  useEffect(() => () => { setProblemStatement(null); }, [setProblemStatement]);

  const selectTab = (t: SolveTab) => {
    setTab(t);
    const mode = TABS.find(x => x.key === t)?.mode;
    if (mode) setAppMode(mode);
  };

  const cases = useMemo(() => sampleCases(problem), [problem]);
  const difficulty = normalizeDifficulty(problem?.difficulty);

  // ── The passing moment ──────────────────────────────────────────────────
  // Fired only when SUBMIT grades every case (samples + hidden) as passing — the
  // real "you solved it". Three unequal tiers: the overwhelming majority get
  // tier 1 — the inline green wash inside TestRunner — and nothing else. A card
  // only interrupts when the solve was genuinely notable, confetti only on a
  // milestone.
  const handleSolved = useCallback((info: PassInfo) => {
    if (!problem) return;
    const record = recordSolve(problem.id);
    setSolved(true);

    let tier: SolvedTier = 'wash';
    if (record.firstTime && record.milestone !== null) tier = 'milestone';
    else if (record.firstTime && (difficulty === 'hard' || info.attempts >= 3)) tier = 'card';

    if (tier === 'wash') return;   // the inline confirmation already happened

    setMoment({
      tier,
      title: problem.title,
      passed: info.passed,
      total: info.total,
      attempts: info.attempts,
      elapsedMs: Date.now() - openedAt.current,
      difficulty,
      tally: record,
    });
  }, [problem, difficulty]);

  const isFailState = status !== 'ok' && status !== 'loading';

  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-zinc-100 overflow-hidden select-none">
      {/* Top bar: brand · title · tabs */}
      <header className="flex items-center justify-between px-4 h-11 border-b border-zinc-800/80 flex-shrink-0 bg-[#09090b]/90 backdrop-blur z-20">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link to="/" className="text-violet-400 font-mono font-semibold text-sm tracking-tight hover:text-violet-300 transition-colors" title="Home">◈ DryRun</Link>
          <span className="text-zinc-700 hidden md:inline">│</span>
          <span className="hidden md:inline text-zinc-400 text-xs font-mono truncate max-w-[46vw]">
            {problem ? problem.title : status === 'loading' ? 'Loading…' : 'Solve'}
          </span>
          {solved && (
            <span
              className="hidden sm:inline-flex items-center gap-1 h-[20px] px-1.5 rounded text-[10px] font-mono text-green-400 bg-green-400/10 border border-green-400/30"
              title="All sample cases passed"
            >
              ✓ Solved
            </span>
          )}
        </div>

        <nav className="flex items-center gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              disabled={status !== 'ok'}
              className={[
                'h-7 px-3 rounded text-[12px] font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                tab === t.key
                  ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Body */}
      {status === 'loading' ? (
        // Skeleton of the layout that is about to arrive, not a blank pane.
        <div className="flex flex-1 overflow-hidden">
          <div style={{ width: `${leftPct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
            <ProblemSkeleton />
          </div>
          <div className="flex-shrink-0" style={{ width: 6 }} />
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <EditorSkeleton />
          </div>
        </div>
      ) : isFailState ? (
        <StatusView status={status} />
      ) : tab === 'code' ? (
        // LeetCode split: problem left, editor + test cases right.
        <div ref={containerRef} className="flex flex-1 overflow-hidden relative">
          <div style={{ width: `${leftPct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
            <ProblemPanel problem={problem!} />
          </div>
          <ColDivider onDrag={dx => {
            const delta = (dx / totalWidth()) * 100;
            setLeftPct(p => Math.min(Math.max(p + delta, 25), 60));
          }} />
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <CodePanel />
            </div>
            {/* Mounted when the question has visible sample cases OR any gradeable
                cases at all (so Submit is reachable even when every case is
                hidden). A legacy row with neither gets no drawer rather than an
                empty one. Keyed on the question so attempts/verdicts reset with it. */}
            {(cases.length > 0 || (problem!.total_cases ?? 0) > 0) && (
              <TestRunner
                key={problem!.id}
                cases={cases}
                problemId={problem!.id}
                totalCases={problem!.total_cases}
                onSolved={handleSolved}
              />
            )}
          </div>

          {moment && (
            <SolvedMoment
              facts={moment}
              onClose={() => setMoment(null)}
              onPrimary={() => { setMoment(null); selectTab('tutor'); }}
              primaryLabel="Explain how it ran →"
            />
          )}
        </div>
      ) : (
        // Animation / Tutor / Interview — the full DryRun experience, problem hidden.
        <ToolWorkspace />
      )}
    </div>
  );
}

function StatusView({ status }: { status: Status }) {
  const MAP: Record<string, { title: string; body: string }> = {
    loading:      { title: 'Loading question…', body: 'Fetching the problem from onlineassessments.tech.' },
    unauthorized: { title: 'Link expired', body: 'This solve link is invalid or has expired. Reopen the question from onlineassessments.tech and click "Solve in DryRun" again.' },
    notfound:     { title: 'Question not found', body: "We couldn't find that question." },
    error:        { title: 'Something went wrong', body: 'Could not load the question. Please try again.' },
  };
  const m = MAP[status] ?? MAP.error;
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h2 className="text-zinc-200 font-mono text-base mb-2">{m.title}</h2>
        <p className="text-zinc-500 text-sm mb-5">{m.body}</p>
        <Link to="/app" className="inline-block text-[13px] font-mono px-3 py-1.5 rounded bg-violet-500/20 text-violet-200 border border-violet-500/30 hover:bg-violet-500/30 transition-colors">
          Open DryRun playground →
        </Link>
      </div>
    </div>
  );
}
