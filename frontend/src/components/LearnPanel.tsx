import { AnimatePresence, motion } from 'framer-motion';
import { GUIDED_PROGRAMS, GuidedProgram } from '../data/guided';
import { useExecutionStore } from '../store/executionStore';

const CONCEPT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Pointers':                    { bg: 'rgba(34,197,94,0.10)',   text: '#4ade80', border: 'rgba(34,197,94,0.25)' },
  'Heap & new/delete':           { bg: 'rgba(249,115,22,0.10)',  text: '#fb923c', border: 'rgba(249,115,22,0.25)' },
  'Memory leaks':                { bg: 'rgba(239,68,68,0.10)',   text: '#f87171', border: 'rgba(239,68,68,0.28)' },
  'Recursion':                   { bg: 'rgba(99,102,241,0.12)',  text: '#818cf8', border: 'rgba(99,102,241,0.28)' },
  'Linked structures':           { bg: 'rgba(56,189,248,0.10)',  text: '#38bdf8', border: 'rgba(56,189,248,0.25)' },
  'Two-pointer / Binary search': { bg: 'rgba(192,132,252,0.10)', text: '#c084fc', border: 'rgba(192,132,252,0.25)' },
  'STL containers':              { bg: 'rgba(245,158,11,0.10)',  text: '#fbbf24', border: 'rgba(245,158,11,0.28)' },
  'Graph traversal':             { bg: 'rgba(20,184,166,0.10)',  text: '#2dd4bf', border: 'rgba(20,184,166,0.28)' },
  'stdin / cin':                 { bg: 'rgba(34,211,238,0.10)',  text: '#22d3ee', border: 'rgba(34,211,238,0.25)' },
};

function ProgramCard({
  program,
  onSelect,
}: {
  program: GuidedProgram;
  onSelect: () => void;
}) {
  const active = useExecutionStore(s => s.activeGuidedProgram?.id === program.id);
  const isLoading = useExecutionStore(s => s.isLoading);
  const palette = CONCEPT_COLORS[program.concept] ?? { bg: 'rgba(82,82,91,0.12)', text: '#a1a1aa', border: 'rgba(82,82,91,0.3)' };

  return (
    <motion.button
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      onClick={onSelect}
      disabled={isLoading}
      className="w-full text-left rounded-lg p-4 flex flex-col gap-2 transition-all disabled:opacity-50"
      style={{
        background: active ? 'rgba(245,158,11,0.06)' : 'rgba(18,18,22,0.95)',
        border: active ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(39,39,42,0.9)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-100 text-[12px] font-mono font-semibold">{program.title}</span>
        <span
          className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: palette.bg, color: palette.text, border: `1px solid ${palette.border}` }}
        >
          {program.concept}
        </span>
      </div>
      <p className="text-zinc-500 text-[11px] font-mono leading-relaxed">{program.description}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-[9px] font-mono text-zinc-600">
          {program.hints.length} hint{program.hints.length !== 1 ? 's' : ''}
        </span>
        {active && (
          <span className="text-[9px] font-mono text-amber-400/70 border border-amber-500/25 px-1 rounded">
            active
          </span>
        )}
      </div>
    </motion.button>
  );
}

export default function LearnPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const loadGuidedProgram = useExecutionStore(s => s.loadGuidedProgram);

  const handleSelect = async (program: GuidedProgram) => {
    onClose();
    await loadGuidedProgram(program);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, x: -24, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="fixed top-12 left-4 z-50 w-80 flex flex-col rounded-xl overflow-hidden"
            style={{
              background: 'rgba(9,9,11,0.98)',
              border: '1px solid rgba(63,63,70,0.7)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)',
              maxHeight: 'calc(100vh - 80px)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
              style={{ borderColor: 'rgba(63,63,70,0.5)' }}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 text-sm">◈</span>
                  <span className="text-zinc-100 text-[13px] font-mono font-semibold">Learn</span>
                </div>
                <p className="text-zinc-600 text-[10px] font-mono mt-0.5">
                  Guided walkthroughs with step-by-step hints
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none ml-3 flex-shrink-0"
              >
                ×
              </button>
            </div>

            {/* Program list */}
            <div className="overflow-y-auto flex-1 p-3 space-y-2">
              {GUIDED_PROGRAMS.map(p => (
                <ProgramCard key={p.id} program={p} onSelect={() => handleSelect(p)} />
              ))}
            </div>

            {/* Footer */}
            <div
              className="px-4 py-2.5 border-t flex-shrink-0"
              style={{ borderColor: 'rgba(63,63,70,0.35)' }}
            >
              <p className="text-zinc-700 text-[9px] font-mono leading-relaxed">
                Hints appear as you step through — use → or Space to advance
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
