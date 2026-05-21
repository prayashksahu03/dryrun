import { useEffect } from 'react';
import { motion } from 'framer-motion';

const TALLY_EMBED = 'https://tally.so/embed/vGJyED?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1';

function isTallySubmission(e: MessageEvent): boolean {
  if (!e.data || typeof e.data !== 'object') return false;
  // Format A: { type: 'tally-form', payload: { type: 'FORM_SUBMITTED', formId } }
  if (e.data.type === 'tally-form' &&
      e.data.payload?.formId === 'vGJyED' &&
      e.data.payload?.type === 'FORM_SUBMITTED') return true;
  // Format B: { type: 'tally.form.event', payload: { type: 'FORM_RESPONSE' } }
  if (e.data.type === 'tally.form.event' &&
      (e.data.payload?.type === 'FORM_RESPONSE' || e.data.payload?.type === 'FORM_SUBMITTED')) return true;
  return false;
}

export default function FeedbackGateModal({ onSubmitted }: { onSubmitted: () => void }) {
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (isTallySubmission(e)) onSubmitted();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onSubmitted]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="relative w-full max-w-lg mx-4 rounded-xl overflow-hidden"
        style={{
          border: '1px solid rgba(139,92,246,0.35)',
          background: '#0d0d12',
          boxShadow: '0 0 80px rgba(139,92,246,0.12), 0 8px 40px rgba(0,0,0,0.7)',
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-4 border-b"
          style={{ borderColor: 'rgba(139,92,246,0.18)', background: 'rgba(139,92,246,0.05)' }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-violet-400 text-base leading-none">◈</span>
            <span className="text-sm font-mono font-semibold text-violet-300">
              You've made 5 runs — share your thoughts to continue
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 font-mono leading-relaxed">
            DryRun is in early access. Your feedback directly shapes what we build next.
            Takes less than 30 seconds.
          </p>
        </div>

        {/* Tally form */}
        <div className="px-1" style={{ background: '#0d0d12' }}>
          <iframe
            src={TALLY_EMBED}
            width="100%"
            height="360"
            frameBorder="0"
            marginHeight={0}
            marginWidth={0}
            title="DryRun feedback"
            style={{ display: 'block', background: 'transparent' }}
          />
        </div>

        {/* Footer hint */}
        <div
          className="px-5 py-2.5 border-t text-[10px] font-mono text-zinc-600 flex items-center justify-between"
          style={{ borderColor: 'rgba(63,63,70,0.4)' }}
        >
          <span>after submitting, you'll get 5 more runs</span>
          <span className="text-violet-500/40">dryrun.ai</span>
        </div>
      </motion.div>
    </div>
  );
}
