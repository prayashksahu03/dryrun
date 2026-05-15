import { AnimatePresence, motion } from 'framer-motion';

export default function HintCard({ hint }: { hint: string | undefined }) {
  return (
    <AnimatePresence>
      {hint && (
        <motion.div
          key={hint}
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 max-w-sm w-[88%] pointer-events-none"
        >
          <div
            className="rounded-lg px-4 py-3 font-mono text-[11px] leading-relaxed"
            style={{
              background: 'rgba(10, 8, 4, 0.94)',
              border: '1px solid rgba(245,158,11,0.35)',
              boxShadow: '0 0 24px rgba(245,158,11,0.08), 0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            <div className="flex items-start gap-2.5">
              <span className="text-amber-400 flex-shrink-0 mt-px text-[13px]">◈</span>
              <p className="text-amber-100/85">{hint}</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
