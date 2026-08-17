import { useEffect, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { useExecutionStore } from './store/executionStore';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import CodePanel from './components/CodePanel';
import MemoryCanvas from './components/MemoryCanvas';
import InspectorPanel from './components/InspectorPanel';
import TimelineBar from './components/TimelineBar';
import PanelToggleBar from './components/PanelToggleBar';
import LearnPanel from './components/LearnPanel';
import TourOverlay, { TOUR_STEPS } from './components/TourOverlay';
import AmbiguityPanel from './components/AmbiguityPanel';
import AiLeftPane from './components/AiLeftPane';
import TutorConversation from './components/TutorConversation';
import InterviewConversation from './components/InterviewConversation';
import type { AppMode } from './store/executionStore';

// ── Column drag handle ────────────────────────────────────────────────────

function ColDivider({ onDrag }: { onDrag: (dx: number) => void }) {
  const isDragging = useRef(false);
  const lastX = useRef(0);
  const [active, setActive] = useState(false);

  return (
    <div
      className="flex-shrink-0 relative group z-30"
      style={{ width: 6, cursor: 'col-resize' }}
      onPointerDown={e => {
        isDragging.current = true;
        setActive(true);
        lastX.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (!isDragging.current) return;
        const dx = e.clientX - lastX.current;
        lastX.current = e.clientX;
        onDrag(dx);
      }}
      onPointerUp={() => { isDragging.current = false; setActive(false); }}
      onPointerCancel={() => { isDragging.current = false; setActive(false); }}
    >
      {/* Visual line */}
      <div
        className="absolute inset-y-0 transition-all duration-100"
        style={{
          left: '50%',
          width: active ? 2 : 1,
          transform: 'translateX(-50%)',
          background: active ? 'rgba(99,102,241,0.65)' : 'rgba(63,63,70,0.65)',
        }}
      />
      {/* Grip dots on hover */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center gap-0.5 transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-70'}`}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="w-0.5 h-0.5 rounded-full bg-indigo-400/70" />
        ))}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const { isPlaying, stepForward, trace, currentStep, playbackSpeed, currentFrame, activeGuidedProgram, appMode, setAppMode } = useExecutionStore();
  useKeyboardNav();

  const frame = currentFrame();
  const isCrash = frame?.event.type === 'crash';

  const [learnOpen, setLearnOpen] = useState(false);
  const isFirstVisit = !localStorage.getItem('dryrun_visited');
  const [tourStep, setTourStep] = useState<number | null>(isFirstVisit ? 0 : null);

  const startTour = () => setTourStep(0);
  const exitTour  = () => {
    localStorage.setItem('dryrun_visited', '1');
    setTourStep(null);
  };

  // Column widths (as percentages of the container)
  const [codePct, setCodePct]           = useState(34);
  const [inspectorPct, setInspectorPct] = useState(22);
  const [aiLeftPct, setAiLeftPct]       = useState(55);  // left (code+animation) share in AI modes
  const containerRef = useRef<HTMLDivElement>(null);

  const totalWidth = () => containerRef.current?.getBoundingClientRect().width ?? 1;

  useEffect(() => {
    if (!isPlaying) return;
    const ms = 1400 / playbackSpeed;
    const id = setTimeout(stepForward, ms);
    return () => clearTimeout(id);
  }, [isPlaying, currentStep, stepForward, playbackSpeed]);

  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-zinc-100 overflow-hidden select-none">
      {/* Nav */}
      <header className="flex items-center justify-between px-5 h-11 border-b border-zinc-800/80 flex-shrink-0 bg-[#09090b]/90 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <span className="text-violet-400 font-mono font-semibold text-sm tracking-tight">◈ DryRun</span>
          <span className="text-zinc-700">│</span>
          <span className="text-zinc-500 text-xs font-mono truncate max-w-xs">
            {activeGuidedProgram ? activeGuidedProgram.title : trace ? trace.name : 'Write your program'}
          </span>
          {activeGuidedProgram && (
            <span className="text-[9px] font-mono text-amber-400/70 border border-amber-500/20 px-1.5 rounded">
              guided
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Mode switch */}
          <div data-tour="mode-switch" className="flex items-center rounded-md border border-zinc-700/60 overflow-hidden">
            {(['debug', 'tutor', 'interview'] as AppMode[]).map(m => {
              const on = appMode === m;
              const disabled = m !== 'debug' && !trace;
              return (
                <button
                  key={m}
                  onClick={() => { if (!disabled) setAppMode(m); }}
                  disabled={disabled}
                  title={disabled ? 'Run a program first' : `${m} mode`}
                  className={[
                    'h-7 px-2.5 text-[11px] font-mono capitalize transition-colors',
                    on ? 'bg-violet-500/25 text-violet-200' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800',
                    disabled ? 'opacity-40 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  {m}
                </button>
              );
            })}
          </div>
          {isCrash && (() => {
            const ev = frame?.event as { type: 'crash'; kind: string } | undefined;
            const LABELS: Record<string, string> = {
              'null-deref': 'NULL DEREF', 'use-after-free': 'USE AFTER FREE',
              'double-free': 'DOUBLE FREE', 'out-of-bounds': 'OUT OF BOUNDS',
              'stack-overflow': 'STACK OVERFLOW', 'division-by-zero': 'DIV BY ZERO',
              'out_of_range': 'UNDERFLOW', 'segfault': 'SEGFAULT',
            };
            const label = ev ? (LABELS[ev.kind] ?? ev.kind.toUpperCase()) : 'CRASH';
            return (
              <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-xs font-mono border border-red-500/30 animate-pulse">
                ✕ {label}
              </span>
            );
          })()}
          {trace && (
            <span className="text-zinc-600 text-xs font-mono">
              step {currentStep + 1}<span className="text-zinc-700">/{trace.steps.length}</span>
            </span>
          )}
          <span className="text-zinc-700 text-xs font-mono hidden sm:block">← → to step  ·  space to play</span>
          <span className="text-[11px] font-mono text-zinc-500 hidden md:block">
            👋 your feedback shapes what we build next —
          </span>
          <a
            href="https://tally.so/r/vGJyED"
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 px-2.5 rounded text-[11px] font-mono font-medium flex items-center transition-all bg-violet-500/15 text-violet-400 border border-violet-500/30 hover:bg-violet-500/25 hover:text-violet-300 hover:border-violet-500/50"
          >
            feedback
          </a>
          <button
            onClick={startTour}
            className="h-7 px-2.5 rounded text-[11px] font-mono text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all border border-zinc-700/50 hover:border-zinc-600/70"
            title="App tour"
          >
            ? tour
          </button>
          <button
            data-tour="learn-button"
            onClick={() => setLearnOpen(o => !o)}
            className={`flex items-center gap-1.5 h-7 px-2.5 rounded text-[11px] font-mono font-medium transition-all ${
              learnOpen || activeGuidedProgram
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/35'
                : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 border border-zinc-700/60'
            }`}
          >
            <span className="text-[10px]">◈</span>
            Learn
          </button>
        </div>
      </header>

      <LearnPanel open={learnOpen} onClose={() => setLearnOpen(false)} />


      {tourStep !== null && (
        <TourOverlay
          stepIndex={tourStep}
          onNext={() => setTourStep(s => (s !== null && s < TOUR_STEPS.length - 1 ? s + 1 : s))}
          onPrev={() => setTourStep(s => (s !== null && s > 0 ? s - 1 : s))}
          onExit={exitTour}
        />
      )}

      {/* Views bar governs the memory panels — Debug mode only */}
      {appMode === 'debug' && <PanelToggleBar />}

      {/* Main area — swaps by mode */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">

        {appMode === 'debug' && (
          <>
            {/* Code panel */}
            <div style={{ width: `${codePct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
              <CodePanel />
            </div>
            <ColDivider onDrag={dx => {
              const delta = (dx / totalWidth()) * 100;
              setCodePct(p => Math.min(Math.max(p + delta, 15), 55));
            }} />
            {/* Memory canvas — flex-1 fills remaining space */}
            <MemoryCanvas />
            <ColDivider onDrag={dx => {
              const delta = (dx / totalWidth()) * 100;
              setInspectorPct(p => Math.min(Math.max(p - delta, 12), 45));
            }} />
            {/* Inspector panel */}
            <div style={{ width: `${inspectorPct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
              <InspectorPanel />
            </div>
          </>
        )}

        {(appMode === 'tutor' || appMode === 'interview') && (
          <>
            {/* Left: code (read-only, line-highlighted) over the animation */}
            <div style={{ width: `${aiLeftPct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
              <AiLeftPane />
            </div>
            <ColDivider onDrag={dx => {
              const delta = (dx / totalWidth()) * 100;
              setAiLeftPct(p => Math.min(Math.max(p + delta, 35), 75));
            }} />
            {/* Right: the full conversation */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              {appMode === 'tutor' ? <TutorConversation /> : <InterviewConversation />}
            </div>
          </>
        )}

      </div>

      <TimelineBar />
      <AmbiguityPanel />
      <Analytics />
    </div>
  );
}
