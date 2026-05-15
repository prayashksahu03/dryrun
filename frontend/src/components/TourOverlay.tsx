import { useLayoutEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// ── Step definitions ──────────────────────────────────────────────────────

interface TourStep {
  target: string;
  title: string;
  body: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="code-editor"]',
    title: 'Code Editor',
    body: 'Write C++ here. Paste competitive-style code directly — main() is required. Use the stdin panel below the editor for cin input. Hit ⌘ Enter or Run to trace.',
    placement: 'right',
  },
  {
    target: '[data-tour="code-toolbar"]',
    title: 'Run & Trace',
    body: 'Hit ⌘ Enter or the Run button to execute. When a trace is loaded the toolbar switches to debug mode — click "← edit code" to go back to the editor.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="timeline"]',
    title: 'Timeline',
    body: 'Every dot is a step. Colors show event type: green = malloc, orange = free, red = crash, indigo = output. Drag to scrub or use ← → keys.',
    placement: 'top',
  },
  {
    target: '[data-tour="stack-zone"]',
    title: 'Stack Memory',
    body: 'Stack frames push when a function is called and pop on return. Variables flash amber when their value changes mid-step.',
    placement: 'right',
  },
  {
    target: '[data-tour="heap-zone"]',
    title: 'Heap Memory',
    body: 'Heap blocks appear on new/malloc with green borders. They turn red-striped when freed. Dangling pointer reads trigger a crash highlight.',
    placement: 'right',
  },
  {
    target: '[data-tour="inspector"]',
    title: 'Inspector',
    body: 'The current event, output log, call tree, and memory state — all synced to the exact step you\'re on. Toggle sections from the view bar above.',
    placement: 'left',
  },
  {
    target: '[data-tour="learn-button"]',
    title: 'Learn Mode',
    body: 'Pick a guided walkthrough — Pointers, Heap, Recursion, Linked List, or Binary Search — and get author-written hints at every key moment.',
    placement: 'bottom',
  },
];

// ── Tooltip positioning ───────────────────────────────────────────────────

const TOOLTIP_W  = 276;
const GAP        = 14;  // distance from spotlight edge to tooltip
const SP_PAD     = 7;   // padding around target element

function tooltipPos(rect: DOMRect, placement: TourStep['placement']): { top: number; left: number } {
  const clampL = (l: number) => Math.max(10, Math.min(l, window.innerWidth - TOOLTIP_W - 10));
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;

  switch (placement) {
    case 'bottom': return { top: rect.bottom + SP_PAD + GAP,          left: clampL(cx - TOOLTIP_W / 2) };
    case 'top':    return { top: rect.top    - SP_PAD - GAP - 160,    left: clampL(cx - TOOLTIP_W / 2) };
    case 'right':  return { top: Math.max(10, cy - 80),               left: rect.right + SP_PAD + GAP };
    case 'left':   return { top: Math.max(10, cy - 80),               left: rect.left - SP_PAD - GAP - TOOLTIP_W };
  }
}

// ── Component ─────────────────────────────────────────────────────────────

export default function TourOverlay({
  stepIndex,
  onNext,
  onPrev,
  onExit,
}: {
  stepIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
}) {
  const step  = TOUR_STEPS[stepIndex];
  const total = TOUR_STEPS.length;
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const el = document.querySelector(step.target);
    if (el) setRect(el.getBoundingClientRect());
    else setRect(null);
  }, [step.target]);

  const isFirst = stepIndex === 0;
  const isLast  = stepIndex === total - 1;

  // Fallback rect centered on screen when target element isn't in the DOM
  const effectiveRect = rect ?? new DOMRect(
    window.innerWidth / 2 - 1, window.innerHeight / 2 - 1, 2, 2,
  );

  const sl  = rect
    ? { top: rect.top - SP_PAD, left: rect.left - SP_PAD, width: rect.width + SP_PAD * 2, height: rect.height + SP_PAD * 2 }
    : null;
  const tip = tooltipPos(effectiveRect, rect ? step.placement : 'bottom');

  const enterDir = { x: step.placement === 'right' ? -10 : step.placement === 'left' ? 10 : 0, y: step.placement === 'bottom' ? -10 : step.placement === 'top' ? 10 : 0 };

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none">
      {/* Spotlight — box-shadow punches the dim backdrop with a transparent hole */}
      {sl ? (
        <motion.div
          key={step.target}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22 }}
          className="absolute rounded-lg pointer-events-none"
          style={{
            top: sl.top, left: sl.left, width: sl.width, height: sl.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.70)',
            border: '1.5px solid rgba(245,158,11,0.5)',
            outline: '3px solid rgba(245,158,11,0.08)',
            outlineOffset: 4,
          }}
        />
      ) : (
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.70)' }} />
      )}

      {/* Tooltip */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stepIndex}
          initial={{ opacity: 0, scale: 0.94, ...enterDir }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="absolute pointer-events-auto"
          style={{ top: tip.top, left: tip.left, width: TOOLTIP_W }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: 'rgba(9,9,11,0.98)',
              border: '1px solid rgba(63,63,70,0.75)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.025)',
            }}
          >
            {/* Progress track */}
            <div className="flex items-center gap-1 px-4 pt-3 pb-0">
              {TOUR_STEPS.map((_, i) => (
                <div
                  key={i}
                  className="h-[3px] rounded-full transition-all duration-300"
                  style={{
                    flex: i === stepIndex ? 2 : 1,
                    background: i === stepIndex
                      ? '#f59e0b'
                      : i < stepIndex
                        ? 'rgba(245,158,11,0.3)'
                        : 'rgba(63,63,70,0.55)',
                  }}
                />
              ))}
            </div>

            {/* Content */}
            <div className="px-4 pt-3 pb-3.5">
              <p className="text-[9px] font-mono text-amber-500/60 uppercase tracking-widest mb-1">
                {stepIndex + 1} of {total}
              </p>
              <h3 className="text-zinc-100 text-[13px] font-mono font-semibold mb-2">{step.title}</h3>
              <p className="text-zinc-400 text-[11px] font-mono leading-[1.65]">{step.body}</p>
            </div>

            {/* Navigation */}
            <div
              className="flex items-center justify-between px-4 py-2.5 border-t"
              style={{ borderColor: 'rgba(39,39,42,0.8)' }}
            >
              <button
                onClick={onExit}
                className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                skip
              </button>
              <div className="flex items-center gap-1.5">
                {!isFirst && (
                  <button
                    onClick={onPrev}
                    className="h-6 px-2.5 rounded text-[10px] font-mono text-zinc-500 hover:text-zinc-200 transition-all border border-zinc-700/70 hover:border-zinc-500/70 hover:bg-zinc-800/60"
                  >
                    ← back
                  </button>
                )}
                <button
                  onClick={isLast ? onExit : onNext}
                  className="h-6 px-3 rounded text-[10px] font-mono font-medium transition-all"
                  style={{
                    background: 'rgba(245,158,11,0.18)',
                    color: '#fcd34d',
                    border: '1px solid rgba(245,158,11,0.38)',
                  }}
                >
                  {isLast ? 'done ✓' : 'next →'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
