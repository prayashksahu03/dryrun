import { motion } from 'framer-motion';
import { ArrayPointer, pointerColor } from './ArrayViz';

const CHAR_W = 26;
const CHAR_H = 32;
const MAX_SHOW = 32;

export default function StringViz({
  name,
  value,
  lastWrite,
  pointers,
}: {
  name: string;
  value: string;
  lastWrite?: number;
  pointers?: ArrayPointer[];
}) {
  const chars = [...value]; // spread so multi-byte chars are handled
  const shown = chars.slice(0, MAX_SHOW);
  const clipped = chars.length > MAX_SHOW;

  const ptrMap = new Map<number, ArrayPointer[]>();
  pointers?.forEach(p => {
    if (p.idx >= 0 && p.idx < chars.length) {
      ptrMap.set(p.idx, [...(ptrMap.get(p.idx) ?? []), p]);
    }
  });
  const hasPointers = ptrMap.size > 0;

  return (
    <div className="mt-1.5 mb-0.5">
      <div className="text-[9px] font-mono text-zinc-600 mb-1">
        {name}
        <span className="text-zinc-700 ml-1">str[{chars.length}]</span>
      </div>

      <div className="flex items-end gap-0 flex-wrap">
        {shown.map((ch, i) => {
          const isHi    = i === lastWrite;
          const ptrs    = ptrMap.get(i);
          const isPointed = !!ptrs?.length;
          const primaryColor = isPointed ? pointerColor(ptrs![0].name) : undefined;

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
                animate={{
                  background: isPointed
                    ? `${primaryColor}18`
                    : isHi
                      ? 'rgba(251,191,36,0.18)'
                      : 'rgba(24,24,27,0.9)',
                  borderColor: isPointed
                    ? `${primaryColor}80`
                    : isHi
                      ? 'rgba(251,191,36,0.6)'
                      : 'rgba(63,63,70,0.5)',
                }}
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

        {clipped && (
          <div className="flex flex-col items-center" style={{ minWidth: 28 }}>
            {hasPointers && <div style={{ minHeight: 28 }} />}
            <span className="text-[8px] font-mono text-zinc-700 mb-0.5"> </span>
            <div
              className="flex items-center justify-center text-[9px] font-mono text-zinc-700"
              style={{ width: 28, height: CHAR_H }}
            >
              +{chars.length - MAX_SHOW}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
