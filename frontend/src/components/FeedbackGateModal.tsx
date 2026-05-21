import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const TALLY_URL = 'https://tally.so/r/vGJyED';

export default function FeedbackGateModal({ onSubmitted }: { onSubmitted: () => void }) {
  const [opened, setOpened] = useState(false);

  const handleOpen = () => {
    window.open(TALLY_URL, '_blank', 'noopener,noreferrer');
    setOpened(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden"
        style={{
          border: '1px solid rgba(139,92,246,0.3)',
          background: 'linear-gradient(160deg, rgba(15,12,28,0.98) 0%, rgba(10,10,16,0.98) 100%)',
          boxShadow: '0 0 0 1px rgba(139,92,246,0.08), 0 24px 80px rgba(0,0,0,0.8), 0 0 60px rgba(139,92,246,0.08)',
        }}
      >
        {/* Subtle top glow line */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.5), transparent)' }}
        />

        <div className="px-6 pt-7 pb-6">
          {/* Icon + heading */}
          <div className="flex flex-col items-center text-center mb-6">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)' }}
            >
              <span className="text-violet-400 text-lg leading-none">◈</span>
            </div>
            <h2 className="text-[15px] font-mono font-semibold text-zinc-100 mb-2 leading-snug">
              Quick feedback needed
            </h2>
            <p className="text-[12px] text-zinc-500 font-mono leading-relaxed max-w-[260px]">
              You've hit 5 runs. Share what you think — it takes under 30 seconds and directly
              shapes what we build next.
            </p>
          </div>

          {/* Divider with label */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">step 1 of 2</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          {/* Step list */}
          <div className="space-y-3 mb-6">
            <div className="flex items-start gap-3">
              <div
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold mt-0.5"
                style={{ background: 'rgba(139,92,246,0.18)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}
              >
                1
              </div>
              <div>
                <div className="text-[11px] font-mono text-zinc-300">Open the feedback form</div>
                <div className="text-[10px] font-mono text-zinc-600 mt-0.5">opens in a new tab · ~3 questions</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold mt-0.5"
                style={{
                  background: opened ? 'rgba(34,197,94,0.15)' : 'rgba(63,63,70,0.3)',
                  color: opened ? '#4ade80' : '#52525b',
                  border: opened ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(63,63,70,0.4)',
                }}
              >
                2
              </div>
              <div>
                <div className={`text-[11px] font-mono ${opened ? 'text-zinc-300' : 'text-zinc-600'}`}>
                  Come back and confirm
                </div>
                <div className="text-[10px] font-mono text-zinc-700 mt-0.5">unlocks 5 more runs</div>
              </div>
            </div>
          </div>

          {/* CTA buttons */}
          <div className="space-y-2.5">
            <button
              onClick={handleOpen}
              className="w-full py-2.5 rounded-lg text-[12px] font-mono font-semibold transition-all flex items-center justify-center gap-2"
              style={{
                background: 'rgba(139,92,246,0.2)',
                color: '#c4b5fd',
                border: '1px solid rgba(139,92,246,0.35)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(139,92,246,0.3)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(139,92,246,0.5)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(139,92,246,0.2)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(139,92,246,0.35)';
              }}
            >
              Open feedback form
              <span className="text-[10px] opacity-70">↗</span>
            </button>

            <AnimatePresence>
              {opened && (
                <motion.button
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={onSubmitted}
                  className="w-full py-2.5 rounded-lg text-[12px] font-mono font-semibold transition-all flex items-center justify-center gap-2"
                  style={{
                    background: 'rgba(34,197,94,0.12)',
                    color: '#4ade80',
                    border: '1px solid rgba(34,197,94,0.25)',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,197,94,0.2)';
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(34,197,94,0.4)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,197,94,0.12)';
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(34,197,94,0.25)';
                  }}
                >
                  ✓ I've submitted — continue
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 border-t flex items-center justify-between"
          style={{ borderColor: 'rgba(39,39,46,0.8)' }}
        >
          <span className="text-[9px] font-mono text-zinc-700">dryrun early access</span>
          <span className="text-[9px] font-mono text-zinc-700">5 runs · feedback · 5 runs · ...</span>
        </div>
      </motion.div>
    </div>
  );
}
