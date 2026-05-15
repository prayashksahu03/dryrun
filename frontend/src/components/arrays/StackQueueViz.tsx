import { motion, AnimatePresence } from 'framer-motion';

// ── Shared ────────────────────────────────────────────────────────────

type AnyVal =
  | number
  | { kind?: string; value?: unknown; fields?: Record<string, AnyVal>; address?: string | null };

function fmtVal(v: AnyVal): string {
  if (v === null || v === undefined) return '?';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'object') return String(v);
  const o = v as { kind?: string; value?: unknown; fields?: Record<string, AnyVal>; address?: string | null };
  if (o.kind === 'int')     return String(o.value ?? 0);
  if (o.kind === 'char')    return o.value ? `'${o.value}'` : "''";
  if (o.kind === 'pointer') return o.address ?? 'NULL';
  if (o.kind === 'struct' && o.fields) {
    const parts = Object.values(o.fields).map(fmtVal);
    return `{${parts.join(',')}}`;
  }
  return '?';
}

function isLastWrite(lastWrite: number[] | undefined, idx: number) {
  return lastWrite?.length === 1 && lastWrite[0] === idx;
}

// ── Stack visualization ───────────────────────────────────────────────
// Interpreter stores [bottom, ..., top]; we render top-to-bottom visually
// so the top of the stack is at the top of the screen.

export function StackViz({
  name,
  values,
  lastWrite,
}: {
  name: string;
  values: AnyVal[];
  lastWrite?: number[];
}) {
  // Reversed: display[0] = top-of-stack = values[last]
  const display = [...values].reverse();
  const topRealIdx = values.length - 1;

  return (
    <div className="mt-1.5 mb-1 select-none">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-zinc-600">
          {name}
          <span className="text-zinc-700 ml-1">[{values.length}]</span>
        </span>
        <span className="text-[8px] font-mono text-indigo-400/50 border border-indigo-500/20 px-1 rounded">
          stack
        </span>
      </div>

      {values.length === 0 ? (
        <div className="text-[10px] font-mono text-zinc-700 px-1">empty</div>
      ) : (
        <div className="flex gap-3 items-start">
          {/* Push arrow + label */}
          <div className="flex flex-col items-center justify-start pt-0.5 gap-0.5 flex-shrink-0">
            <span className="text-[8px] font-mono text-indigo-400/60">push</span>
            <span className="text-indigo-400/50 text-[10px] leading-none">↑</span>
          </div>

          {/* Stack body */}
          <div className="flex flex-col gap-px flex-shrink-0" style={{ minWidth: 56 }}>
            <AnimatePresence initial={false}>
              {display.map((v, di) => {
                const realIdx = topRealIdx - di;
                const isTop = di === 0;
                const isBot = di === display.length - 1;
                const isNew = isLastWrite(lastWrite, realIdx);

                return (
                  <motion.div
                    key={realIdx}
                    initial={{ opacity: 0, y: -8, scaleY: 0.7 }}
                    animate={{ opacity: 1, y: 0, scaleY: 1 }}
                    exit={{ opacity: 0, y: -8, scaleY: 0.7 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    className="relative flex items-center justify-center font-mono text-[10px] font-semibold"
                    style={{
                      height: 28,
                      background: isNew
                        ? 'rgba(251,191,36,0.15)'
                        : isTop
                          ? 'rgba(99,102,241,0.10)'
                          : 'rgba(24,24,27,0.85)',
                      border: `1px solid ${
                        isNew
                          ? 'rgba(251,191,36,0.55)'
                          : isTop
                            ? 'rgba(99,102,241,0.40)'
                            : 'rgba(63,63,70,0.50)'
                      }`,
                      borderRadius: isTop && isBot
                        ? 4
                        : isTop
                          ? '4px 4px 0 0'
                          : isBot
                            ? '0 0 4px 4px'
                            : 0,
                      color: isNew ? '#fbbf24' : isTop ? '#a5b4fc' : '#a1a1aa',
                    }}
                  >
                    {fmtVal(v)}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* TOP / BOT labels */}
          <div
            className="flex flex-col justify-between flex-shrink-0"
            style={{ height: display.length * 29 - 1 }}
          >
            <span className="text-[8px] font-mono text-indigo-400/70 leading-[28px]">← top</span>
            {display.length > 1 && (
              <span className="text-[8px] font-mono text-zinc-600 leading-[28px]">← btm</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Queue visualization ───────────────────────────────────────────────
// Interpreter stores [front, ..., back]; element 0 is next to dequeue.

export function QueueViz({
  name,
  values,
  lastWrite,
}: {
  name: string;
  values: AnyVal[];
  lastWrite?: number[];
}) {
  return (
    <div className="mt-1.5 mb-1 select-none">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-zinc-600">
          {name}
          <span className="text-zinc-700 ml-1">[{values.length}]</span>
        </span>
        <span className="text-[8px] font-mono text-emerald-400/50 border border-emerald-500/20 px-1 rounded">
          queue
        </span>
      </div>

      {values.length === 0 ? (
        <div className="text-[10px] font-mono text-zinc-700 px-1">empty</div>
      ) : (
        <div className="flex flex-col gap-1">
          {/* Direction labels */}
          <div className="flex items-center gap-0">
            {/* Dequeue side */}
            <div className="flex items-center gap-0.5 flex-shrink-0 mr-1">
              <span className="text-[8px] font-mono text-red-400/70">out</span>
              <span className="text-red-400/60 text-[10px]">←</span>
            </div>

            {/* Cells */}
            <div className="flex items-center gap-px overflow-x-auto">
              <AnimatePresence initial={false}>
                {values.map((v, i) => {
                  const isFront = i === 0;
                  const isBack  = i === values.length - 1;
                  const isNew   = isLastWrite(lastWrite, i);

                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: 12, scaleX: 0.7 }}
                      animate={{ opacity: 1, x: 0, scaleX: 1 }}
                      exit={{ opacity: 0, x: -12, scaleX: 0.7 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                      className="flex items-center justify-center font-mono text-[10px] font-semibold flex-shrink-0"
                      style={{
                        width: 36,
                        height: 28,
                        background: isNew
                          ? 'rgba(251,191,36,0.15)'
                          : isFront
                            ? 'rgba(239,68,68,0.08)'
                            : isBack
                              ? 'rgba(34,197,94,0.08)'
                              : 'rgba(24,24,27,0.85)',
                        border: `1px solid ${
                          isNew
                            ? 'rgba(251,191,36,0.55)'
                            : isFront
                              ? 'rgba(239,68,68,0.30)'
                              : isBack
                                ? 'rgba(34,197,94,0.25)'
                                : 'rgba(63,63,70,0.50)'
                        }`,
                        borderRadius: isFront && isBack
                          ? 4
                          : isFront
                            ? '4px 0 0 4px'
                            : isBack
                              ? '0 4px 4px 0'
                              : 0,
                        color: isNew ? '#fbbf24' : isFront ? '#fca5a5' : isBack ? '#86efac' : '#a1a1aa',
                      }}
                    >
                      {fmtVal(v)}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Enqueue side */}
            <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
              <span className="text-green-400/60 text-[10px]">←</span>
              <span className="text-[8px] font-mono text-green-400/70">in</span>
            </div>
          </div>

          {/* Front / back sublabels */}
          {values.length > 1 && (
            <div className="flex items-center" style={{ paddingLeft: 32 }}>
              <span className="text-[8px] font-mono text-red-400/50" style={{ width: 36, textAlign: 'center' }}>
                front
              </span>
              <div className="flex-1" />
              <span className="text-[8px] font-mono text-green-400/50" style={{ width: 36, textAlign: 'center' }}>
                back
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
