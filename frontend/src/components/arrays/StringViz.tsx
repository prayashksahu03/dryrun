import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrayPointer, pointerColor } from './ArrayViz';

const CHAR_W = 26;
const CHAR_H = 32;

export default function StringViz({
  name,
  value,
  lastWrite,
  pointers,
  windowLeft,
  windowRight,
}: {
  name: string;
  value: string;
  lastWrite?: number;
  pointers?: ArrayPointer[];
  windowLeft?: number;
  windowRight?: number;
}) {
  const chars = [...value];
  const scrollRef = useRef<HTMLDivElement>(null);

  const ptrMap = new Map<number, ArrayPointer[]>();
  pointers?.forEach(p => {
    if (p.idx >= 0 && p.idx < chars.length) {
      ptrMap.set(p.idx, [...(ptrMap.get(p.idx) ?? []), p]);
    }
  });
  const hasPointers = ptrMap.size > 0;

  // Scroll to keep the active pointer (or last-write) in view
  const focusIdx = pointers && pointers.length > 0
    ? Math.max(...pointers.map(p => p.idx))
    : (lastWrite ?? -1);

  useEffect(() => {
    if (focusIdx < 0 || !scrollRef.current) return;
    const cell = scrollRef.current.children[focusIdx] as HTMLElement | undefined;
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [focusIdx]);

  return (
    <div className="mt-1.5 mb-0.5">
      <div className="text-[9px] font-mono text-zinc-600 mb-1">
        {name}
        <span className="text-zinc-700 ml-1">str[{chars.length}]</span>
      </div>

      {/* Sliding-window bracket */}
      {windowLeft !== undefined && windowRight !== undefined && windowLeft <= windowRight && (
        <div className="relative mb-1" style={{
          width: `${(windowRight - windowLeft + 1) * CHAR_W}px`,
          marginLeft: `${windowLeft * CHAR_W}px`,
        }}>
          <div className="rounded-sm" style={{
            height: 3,
            background: 'rgba(99,102,241,0.35)',
            boxShadow: '0 0 6px rgba(99,102,241,0.4)',
          }} />
        </div>
      )}

      <div className="overflow-x-auto no-scrollbar">
        <div ref={scrollRef} className="flex items-end gap-0" style={{ width: 'max-content' }}>
          {chars.map((ch, i) => {
            const isHi      = i === lastWrite;
            const inWin     = windowLeft !== undefined && windowRight !== undefined && i >= windowLeft && i <= windowRight;
            const ptrs      = ptrMap.get(i);
            const isPointed = !!ptrs?.length;
            const primaryColor = isPointed ? pointerColor(ptrs![0].name) : undefined;

            const bgColor = isPointed
              ? `${primaryColor}18`
              : isHi
                ? 'rgba(251,191,36,0.18)'
                : inWin
                  ? 'rgba(99,102,241,0.08)'
                  : 'rgba(24,24,27,0.9)';
            const bdColor = isPointed
              ? `${primaryColor}80`
              : isHi
                ? 'rgba(251,191,36,0.6)'
                : inWin
                  ? 'rgba(99,102,241,0.4)'
                  : 'rgba(63,63,70,0.5)';

            return (
              <div key={i} className="flex flex-col items-center" style={{ minWidth: CHAR_W }}>
                {/* Pointer label(s) */}
                {hasPointers && (
                  <div className="flex flex-col items-center" style={{ minHeight: 20 }}>
                    {ptrs?.map(p => (
                      <span
                        key={p.name}
                        className="text-[8px] font-mono leading-tight"
                        style={{ color: pointerColor(p.name) }}
                      >
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}
                {/* Downward arrow */}
                {hasPointers && (
                  <div style={{ height: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isPointed && (
                      <span className="text-[8px]" style={{ color: primaryColor, lineHeight: 1 }}>▼</span>
                    )}
                  </div>
                )}
                {/* Index label */}
                <span className="text-[8px] font-mono text-zinc-700 mb-0.5">{i}</span>
                {/* Character cell */}
                <motion.div
                  animate={{ background: bgColor, borderColor: bdColor }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center justify-center text-[10px] font-mono font-semibold border"
                  style={{
                    width: CHAR_W - 1,
                    height: CHAR_H,
                    color: isPointed
                      ? primaryColor
                      : isHi
                        ? '#fbbf24'
                        : ch === ' '
                          ? '#3f3f46'
                          : '#86efac',
                  }}
                >
                  {ch === ' ' ? '·' : ch}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
