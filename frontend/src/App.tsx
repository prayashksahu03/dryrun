import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu } from 'lucide-react';
import ToolNavDrawer from './components/ToolNavDrawer';
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
import ArtifactPanel from './components/ArtifactPanel';
import TutorConversation from './components/TutorConversation';
import InterviewConversation from './components/InterviewConversation';

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
  const { isPlaying, stepForward, trace, currentStep, playbackSpeed, currentFrame, activeGuidedProgram, appMode } = useExecutionStore();
  useKeyboardNav();

  const frame = currentFrame();
  const isCrash = frame?.event.type === 'crash';

  const [learnOpen, setLearnOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
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
  const [aiLeftPct, setAiLeftPct]       = useState(48);  // left share in AI modes (chat / code)
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
      <header className="flex items-center justify-between px-4 h-11 border-b border-zinc-800/80 flex-shrink-0 bg-[#09090b]/90 backdrop-blur z-20">
        <div className="flex items-center gap-2.5">
          <button
            data-tour="menu"
            onClick={() => setNavOpen(true)}
            title="Menu"
            aria-label="Open menu"
            className="h-8 w-8 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <Menu size={18} />
          </button>
          <Link to="/" className="text-violet-400 font-mono font-semibold text-sm tracking-tight hover:text-violet-300 transition-colors" title="Home">◈ DryRun</Link>
          <span className="hidden sm:inline text-[10px] font-mono capitalize px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/25">
            {appMode}
          </span>
          <span className="text-zinc-700 hidden md:inline">│</span>
          <span className="hidden md:inline text-zinc-500 text-xs font-mono truncate max-w-xs">
            {activeGuidedProgram ? activeGuidedProgram.title : trace ? trace.name : 'Write your program'}
          </span>
          {activeGuidedProgram && (
            <span className="text-[9px] font-mono text-amber-400/70 border border-amber-500/20 px-1.5 rounded">
              guided
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
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
        </div>
      </header>

      <ToolNavDrawer open={navOpen} onClose={() => setNavOpen(false)} onStartTour={startTour} />
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

        {/* Tutor: conversation is the hero (left); the live artifact (Animation |
            Code tabs) is on the right. */}
        {appMode === 'tutor' && (
          <>
            <div style={{ width: `${aiLeftPct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
              <TutorConversation />
            </div>
            <ColDivider onDrag={dx => {
              const delta = (dx / totalWidth()) * 100;
              setAiLeftPct(p => Math.min(Math.max(p + delta, 30), 65));
            }} />
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <ArtifactPanel />
            </div>
          </>
        )}

        {/* Interview: no animation — just the code and the interview chat. */}
        {appMode === 'interview' && (
          <>
            <div style={{ width: `${aiLeftPct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
              <CodePanel readOnly />
            </div>
            <ColDivider onDrag={dx => {
              const delta = (dx / totalWidth()) * 100;
              setAiLeftPct(p => Math.min(Math.max(p + delta, 30), 65));
            }} />
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <InterviewConversation />
            </div>
          </>
        )}

      </div>

      <TimelineBar />
      <AmbiguityPanel />
    </div>
  );
}
