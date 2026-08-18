import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Home, GraduationCap, MessageSquare, HelpCircle } from 'lucide-react';

// Left slide-in nav for the tool (opened by the header hamburger). Navigation +
// tour/feedback only — the mode switch (Debug/Tutor/Interview) lives as tabs in
// the header now.
export default function ToolNavDrawer({
  open, onClose, onStartTour,
}: { open: boolean; onClose: () => void; onStartTour: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <motion.aside
            initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className="fixed left-0 top-0 z-50 h-full w-72 bg-[#0d0d0f] border-r border-zinc-800 flex flex-col font-mono"
          >
            <div className="flex items-center justify-between px-4 h-11 border-b border-zinc-800 flex-shrink-0">
              <span className="text-violet-400 font-semibold text-sm tracking-tight">◈ DryRun</span>
              <button onClick={onClose} title="Close" className="text-zinc-500 hover:text-zinc-200 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* Navigate */}
              <div>
                <div className="text-[9px] uppercase tracking-widest text-zinc-600 px-1 mb-1.5">Navigate</div>
                <Link to="/" onClick={onClose} className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[12px] text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200 transition-colors">
                  <Home size={14} /> Home
                </Link>
                <Link to="/learn" onClick={onClose} className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[12px] text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200 transition-colors">
                  <GraduationCap size={14} /> Learn
                </Link>
              </div>

              {/* More */}
              <div className="border-t border-zinc-800/70 pt-3">
                <button onClick={() => { onClose(); onStartTour(); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[12px] text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200 transition-colors">
                  <HelpCircle size={14} /> Take the tour
                </button>
                <a href="https://tally.so/r/vGJyED" target="_blank" rel="noreferrer" className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[12px] text-violet-400 hover:bg-violet-500/10 transition-colors">
                  <MessageSquare size={14} /> Feedback
                </a>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-zinc-800 text-[10px] text-zinc-600 flex-shrink-0">
              ← → step · space play
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
