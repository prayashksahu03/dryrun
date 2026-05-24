import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const TALLY_EMBED = 'https://tally.so/embed/vGJyED?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1';

function isTallySubmission(e: MessageEvent): boolean {
  if (!e.data || typeof e.data !== 'object') return false;
  if (e.data.type === 'tally-form' && e.data.payload?.formId === 'vGJyED' && e.data.payload?.type === 'FORM_SUBMITTED') return true;
  if (e.data.type === 'tally.form.event' && (e.data.payload?.type === 'FORM_RESPONSE' || e.data.payload?.type === 'FORM_SUBMITTED')) return true;
  return false;
}

export default function FeedbackGateModal({ onSubmitted }: { onSubmitted: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeLoads = useRef(0);

  const confirm = (delay = 0) => {
    setSubmitted(true);
    setTimeout(onSubmitted, delay);
  };

  // Auto-close via Tally postMessage (fires on production when cross-origin allows it)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (isTallySubmission(e)) confirm(1200);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fallback: Tally navigates the iframe to a thank-you page after submit,
  // which fires a second 'load' event. Detect that as submission confirmation.
  const handleIframeLoad = () => {
    iframeLoads.current += 1;
    if (iframeLoads.current >= 2) confirm(1200);
  };

  const handleConfirm = () => confirm(0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative w-full max-w-md mx-4 rounded-2xl overflow-hidden"
        style={{
          border: '1px solid rgba(139,92,246,0.28)',
          boxShadow: '0 0 0 1px rgba(139,92,246,0.06), 0 32px 80px rgba(0,0,0,0.85)',
        }}
      >
        {/* ── Dark header — DryRun branded ── */}
        <div
          style={{
            background: 'linear-gradient(160deg, rgba(18,14,36,0.99) 0%, rgba(12,10,22,0.99) 100%)',
            borderBottom: '1px solid rgba(139,92,246,0.15)',
          }}
          className="px-6 pt-6 pb-5"
        >
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.55), transparent)' }}
          />
          <div className="flex items-center gap-2.5 mb-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.28)' }}
            >
              <span className="text-violet-400 text-sm leading-none">◈</span>
            </div>
            <span className="text-[13px] font-mono font-semibold text-zinc-100">
              Share your feedback to continue
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 font-mono leading-relaxed pl-[2.375rem]">
            You've made 5 runs. Takes under 30 seconds — your input directly shapes what we build next.
          </p>
        </div>

        {/* ── Form section ── */}
        <div style={{ background: '#ffffff', position: 'relative' }}>
          <AnimatePresence mode="wait">
            {submitted ? (
              <motion.div
                key="thanks"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-12 gap-3"
                style={{ background: '#ffffff' }}
              >
                <motion.div
                  initial={{ scale: 0.5 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)' }}
                >
                  <span className="text-green-500 text-xl">✓</span>
                </motion.div>
                <p className="text-sm font-mono text-zinc-800 font-semibold">Thanks for the feedback!</p>
                <p className="text-xs font-mono text-zinc-500">Unlocking 5 more runs…</p>
              </motion.div>
            ) : (
              <motion.div key="form">
                <iframe
                  ref={iframeRef}
                  src={TALLY_EMBED}
                  width="100%"
                  height="340"
                  frameBorder="0"
                  marginHeight={0}
                  marginWidth={0}
                  title="DryRun feedback"
                  style={{ display: 'block' }}
                  onLoad={handleIframeLoad}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Dark footer ── */}
        <div
          className="px-5 py-2.5 flex items-center justify-between gap-3"
          style={{
            background: 'rgba(10,8,20,0.98)',
            borderTop: '1px solid rgba(39,36,56,0.8)',
          }}
        >
          <span className="text-[9px] font-mono text-zinc-700 flex-shrink-0">
            fill the form above, then click →
          </span>
          {!submitted && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleConfirm}
              className="text-[10px] font-mono px-2.5 py-1 rounded flex-shrink-0"
              style={{
                background: 'rgba(34,197,94,0.15)',
                color: '#4ade80',
                border: '1px solid rgba(34,197,94,0.3)',
              }}
            >
              ✓ I've submitted
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
