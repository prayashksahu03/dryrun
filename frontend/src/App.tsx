import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu } from 'lucide-react';
import ToolNavDrawer from './components/ToolNavDrawer';
import { useExecutionStore } from './store/executionStore';
import LearnPanel from './components/LearnPanel';
import TourOverlay, { TOUR_STEPS } from './components/TourOverlay';
import ToolWorkspace from './components/ToolWorkspace';

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const { trace, currentStep, currentFrame, activeGuidedProgram, appMode } = useExecutionStore();

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

  return (
    <div className="flex flex-col h-full bg-[#09090b] text-zinc-100 overflow-hidden select-none">
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

      <ToolWorkspace />
    </div>
  );
}
