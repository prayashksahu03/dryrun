import { useEffect, useRef, useState } from 'react';
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
  const { isPlaying, stepForward, trace, currentStep, playbackSpeed, currentFrame, activeGuidedProgram } = useExecutionStore();
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
          <span className="text-violet-400 font-mono font-semibold text-sm tracking-tight">◈ MemTrace</span>
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
          {isCrash && (
            <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-xs font-mono border border-red-500/30 animate-pulse">
              SEGFAULT
            </span>
          )}
          {trace && (
            <span className="text-zinc-600 text-xs font-mono">
              step {currentStep + 1}<span className="text-zinc-700">/{trace.steps.length}</span>
            </span>
          )}
          <span className="text-zinc-700 text-xs font-mono hidden sm:block">← → to step  ·  space to play</span>
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

      <PanelToggleBar />

      {/* Main — three resizable columns */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">

        {/* Code panel */}
        <div
          style={{ width: `${codePct}%` }}
          className="flex-shrink-0 flex flex-col overflow-hidden"
        >
          <CodePanel />
        </div>

        {/* Drag handle: code | canvas */}
        <ColDivider onDrag={dx => {
          const delta = (dx / totalWidth()) * 100;
          setCodePct(p => Math.min(Math.max(p + delta, 15), 55));
        }} />

        {/* Memory canvas — flex-1 fills remaining space */}
        <MemoryCanvas />

        {/* Drag handle: canvas | inspector */}
        <ColDivider onDrag={dx => {
          const delta = (dx / totalWidth()) * 100;
          setInspectorPct(p => Math.min(Math.max(p - delta, 12), 45));
        }} />

        {/* Inspector panel */}
        <div
          style={{ width: `${inspectorPct}%` }}
          className="flex-shrink-0 flex flex-col overflow-hidden"
        >
          <InspectorPanel />
        </div>

      </div>

      <TimelineBar />
      <AmbiguityPanel />
    </div>
  );
}
