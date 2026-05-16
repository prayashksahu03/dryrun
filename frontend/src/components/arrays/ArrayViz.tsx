import { motion } from 'framer-motion';
import { useRef, useEffect } from 'react';

const CELL_W = 36;
const CELL_H = 32;

// ── Pointer markers ───────────────────────────────────────────────────

export interface ArrayPointer { name: string; idx: number }

export const POINTER_COLORS: Record<string, string> = {
  left: '#67e8f9', lo: '#67e8f9', l: '#67e8f9', start: '#67e8f9', slow: '#67e8f9',
  right: '#c4b5fd', hi: '#c4b5fd', r: '#c4b5fd', end: '#c4b5fd', fast: '#c4b5fd',
  mid: '#fbbf24', m: '#fbbf24',
  i: '#86efac', j: '#86efac',
  p: '#fb923c', q: '#fb923c',
};
export function pointerColor(name: string) {
  return POINTER_COLORS[name] ?? '#a1a1aa';
}

// ── Value formatter ───────────────────────────────────────────────────
// Handles plain numbers, {kind:'int'|'char', value}, {kind:'struct', fields}, etc.

type AnyVal = number | { kind?: string; value?: unknown; fields?: Record<string, AnyVal>; address?: string | null; values?: AnyVal[] };

function fmtCell(v: AnyVal): string {
  if (v === null || v === undefined) return '?';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'object') return String(v);
  const o = v as { kind?: string; value?: unknown; fields?: Record<string, AnyVal>; address?: string | null; values?: AnyVal[] };
  if (o.kind === 'int') return String(o.value ?? 0);
  if (o.kind === 'char') return o.value ? `'${o.value}'` : "''";
  if (o.kind === 'pointer') return o.address != null ? String(o.address) : 'NULL';
  if (o.kind === 'struct' && o.fields) {
    const parts = Object.values(o.fields).map(fmtCell);
    return `{${parts.join(',')}}`;
  }
  if (o.kind === 'array') return '[…]';
  return String(v);
}

// ── 1D array ─────────────────────────────────────────────────────────

function Array1D({
  name,
  values,
  lastWrite,
  pointers,
  windowLeft,
  windowRight,
}: {
  name: string;
  values: number[];
  lastWrite?: number[];
  pointers?: ArrayPointer[];
  windowLeft?: number;
  windowRight?: number;
}) {
  // lastWrite.length === 1 → single highlight; length === 2 → swap dual-highlight
  const hi   = lastWrite?.length === 1 ? lastWrite[0] : -1;
  const swap0 = lastWrite?.length === 2 ? lastWrite[0] : -1;
  const swap1 = lastWrite?.length === 2 ? lastWrite[1] : -1;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Group pointers by index for quick lookup
  const ptrMap = new Map<number, ArrayPointer[]>();
  pointers?.forEach(p => {
    if (p.idx >= 0 && p.idx < values.length) {
      ptrMap.set(p.idx, [...(ptrMap.get(p.idx) ?? []), p]);
    }
  });
  const hasPointers = ptrMap.size > 0;

  // Scroll to keep the active pointer (or last-write highlight) in view
  const focusIdx = pointers && pointers.length > 0
    ? Math.max(...pointers.map(p => p.idx))
    : hi >= 0 ? hi : -1;

  useEffect(() => {
    if (focusIdx < 0 || !scrollRef.current) return;
    const cell = scrollRef.current.children[focusIdx] as HTMLElement | undefined;
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [focusIdx]);

  return (
    <div className="mt-1.5 mb-0.5">
      <div className="text-[9px] font-mono text-zinc-600 mb-1">
        {name}
        <span className="text-zinc-700 ml-1">[{values.length}]</span>
      </div>

      {/* Sliding-window bracket */}
      {windowLeft !== undefined && windowRight !== undefined && windowLeft <= windowRight && (
        <div className="relative mb-1" style={{ width: `${(windowRight - windowLeft + 1) * CELL_W}px`, marginLeft: `${windowLeft * CELL_W}px` }}>
          <div className="rounded-sm" style={{
            height: 3,
            background: 'rgba(99,102,241,0.35)',
            boxShadow: '0 0 6px rgba(99,102,241,0.4)',
          }} />
        </div>
      )}

      <div className="overflow-x-auto no-scrollbar">
        <div ref={scrollRef} className="flex items-end gap-0" style={{ width: 'max-content' }}>
          {values.map((v, i) => {
            const isHi    = i === hi;
            const isSwap  = i === swap0 || i === swap1;
            const inWin   = windowLeft !== undefined && windowRight !== undefined && i >= windowLeft && i <= windowRight;
            const ptrs    = ptrMap.get(i);
            const isPointed = !!ptrs?.length;

            const bgColor = isSwap
              ? 'rgba(167,139,250,0.22)'
              : isPointed
                ? `${pointerColor(ptrs![0].name)}18`
                : isHi
                  ? 'rgba(251,191,36,0.18)'
                  : inWin
                    ? 'rgba(99,102,241,0.08)'
                    : 'rgba(24,24,27,0.9)';
            const bdColor = isSwap
              ? 'rgba(167,139,250,0.7)'
              : isPointed
                ? `${pointerColor(ptrs![0].name)}80`
                : isHi
                  ? 'rgba(251,191,36,0.6)'
                  : inWin
                    ? 'rgba(99,102,241,0.4)'
                    : 'rgba(63,63,70,0.5)';
            const txtColor = isSwap
              ? '#c4b5fd'
              : isPointed
                ? pointerColor(ptrs![0].name)
                : isHi
                  ? '#fbbf24'
                  : '#a1a1aa';

            return (
              <div key={i} className="flex flex-col items-center" style={{ minWidth: CELL_W }}>
                {/* Pointer labels */}
                {hasPointers && (
                  <div className="flex flex-col items-center" style={{ minHeight: 20 }}>
                    {ptrs?.map(p => (
                      <span key={p.name} className="text-[8px] font-mono leading-tight"
                        style={{ color: pointerColor(p.name) }}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}
                {/* Downward arrow */}
                {hasPointers && (
                  <div style={{ height: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isPointed && (
                      <span className="text-[8px]" style={{ color: pointerColor(ptrs![0].name), lineHeight: 1 }}>▼</span>
                    )}
                  </div>
                )}
                {/* Index label */}
                <span className="text-[8px] font-mono text-zinc-700 mb-0.5">{i}</span>
                {/* Cell */}
                <motion.div
                  animate={{ background: bgColor, borderColor: bdColor }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center justify-center text-[10px] font-mono font-semibold border"
                  style={{ width: CELL_W - 1, height: CELL_H, color: txtColor }}
                >
                  {fmtCell(v as AnyVal)}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 2D array (DP table) ───────────────────────────────────────────────

function Array2D({
  name,
  values,
  rows,
  cols,
  lastWrite,
}: {
  name: string;
  values: number[][];
  rows: number;
  cols: number;
  lastWrite?: number[];
}) {
  const hiRow = lastWrite?.length === 2 ? lastWrite[0] : -1;
  const hiCol = lastWrite?.length === 2 ? lastWrite[1] : -1;

  const MAX_COLS = 16;
  const MAX_ROWS = 12;
  const shownCols = Math.min(cols, MAX_COLS);
  const shownRows = Math.min(rows, MAX_ROWS);

  return (
    <div className="mt-2 mb-1">
      <div className="text-[9px] font-mono text-zinc-600 mb-1.5">
        {name}
        <span className="text-zinc-700 ml-1">[{rows}][{cols}]</span>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {/* Corner cell */}
              <td style={{ width: 20, minWidth: 20 }} />
              {Array.from({ length: shownCols }, (_, j) => (
                <td key={j} className="text-center text-[8px] font-mono text-zinc-700 pb-0.5"
                  style={{ width: CELL_W, minWidth: CELL_W }}>
                  {j}
                </td>
              ))}
              {cols > MAX_COLS && (
                <td className="text-[8px] font-mono text-zinc-700 pl-1">…</td>
              )}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: shownRows }, (_, i) => (
              <tr key={i}>
                {/* Row index */}
                <td className="text-right text-[8px] font-mono text-zinc-700 pr-1.5"
                  style={{ width: 20, minWidth: 20 }}>
                  {i}
                </td>
                {Array.from({ length: shownCols }, (_, j) => {
                  const isHi = i === hiRow && j === hiCol;
                  const v = values[i]?.[j] ?? 0;
                  return (
                    <td key={j} style={{ padding: 0, width: CELL_W }}>
                      <motion.div
                        animate={{
                          background: isHi ? 'rgba(251,191,36,0.18)' : 'rgba(24,24,27,0.9)',
                          borderColor: isHi ? 'rgba(251,191,36,0.6)' : 'rgba(63,63,70,0.5)',
                        }}
                        transition={{ duration: 0.25 }}
                        className="flex items-center justify-center text-[10px] font-mono font-semibold border"
                        style={{
                          width: CELL_W - 1,
                          height: CELL_H,
                          color: isHi ? '#fbbf24' : v !== 0 ? '#d4d4d8' : '#52525b',
                          margin: '0 auto',
                        }}
                      >
                        {v}
                      </motion.div>
                    </td>
                  );
                })}
                {cols > MAX_COLS && (
                  <td className="text-[9px] font-mono text-zinc-700 pl-1">…</td>
                )}
              </tr>
            ))}
            {rows > MAX_ROWS && (
              <tr>
                <td colSpan={shownCols + 1}
                  className="text-center text-[8px] font-mono text-zinc-700 pt-0.5">
                  +{rows - MAX_ROWS} more rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────

// ── Vector of pairs ───────────────────────────────────────────────────

type PairVal = { kind: 'struct'; fields: { first: AnyVal; second: AnyVal } };

function PairVectorViz({ name, values }: { name: string; values: PairVal[] }) {
  return (
    <div className="mt-1.5 mb-0.5">
      <div className="text-[9px] font-mono text-zinc-600 mb-1">
        {name}
        <span className="text-zinc-700 ml-1">[{values.length}]</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {values.slice(0, 16).map((pair, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <span className="text-[8px] font-mono text-zinc-700">{i}:</span>
            <span className="text-[9px] font-mono text-amber-400 border border-zinc-700/60 rounded px-1 py-0.5 bg-zinc-900/60">
              ({fmtCell(pair.fields?.first)}, {fmtCell(pair.fields?.second)})
            </span>
          </div>
        ))}
        {values.length > 16 && (
          <span className="text-[8px] font-mono text-zinc-700">+{values.length - 16} more</span>
        )}
      </div>
    </div>
  );
}

// ── Adjacency list (array of inner array objects) ─────────────────────

function AdjListViz({ name, values }: { name: string; values: Array<{ kind: string; values: AnyVal[] }> }) {
  return (
    <div className="mt-1.5 mb-0.5">
      <div className="text-[9px] font-mono text-zinc-600 mb-1">
        {name}
        <span className="text-zinc-700 ml-1">[{values.length}]</span>
      </div>
      <div className="space-y-0.5">
        {values.slice(0, 12).map((inner, i) => {
          const neighbors: AnyVal[] = Array.isArray(inner?.values) ? inner.values : [];
          return (
            <div key={i} className="flex items-center gap-1.5 px-1">
              <span className="text-[9px] font-mono text-zinc-600 w-4 text-right flex-shrink-0">{i}</span>
              <span className="text-zinc-700 text-[9px]">→</span>
              <span className="text-[9px] font-mono text-zinc-400">
                [{neighbors.map(fmtCell).join(', ')}]
              </span>
            </div>
          );
        })}
        {values.length > 12 && (
          <div className="text-[8px] font-mono text-zinc-700 px-1">+{values.length - 12} more</div>
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────

export default function ArrayViz({
  name,
  values,
  rows,
  cols,
  lastWrite,
  pointers,
  windowLeft,
  windowRight,
}: {
  name: string;
  values: number[] | number[][] | unknown[];
  rows?: number;
  cols?: number;
  lastWrite?: number[];
  pointers?: ArrayPointer[];
  windowLeft?: number;
  windowRight?: number;
}) {
  // Non-primitive elements — route by element kind
  if (!rows && !cols && values.length > 0 && typeof values[0] === 'object' && values[0] !== null && !Array.isArray(values[0])) {
    const first = values[0] as { kind?: string; fields?: Record<string, AnyVal> };
    // Scalar VariableValue elements (int / char / pointer from stack<T>, queue<T> etc.)
    if (first.kind === 'int' || first.kind === 'char' || first.kind === 'pointer') {
      return (
        <Array1D
          name={name}
          values={values as number[]}
          lastWrite={lastWrite}
          pointers={pointers}
          windowLeft={windowLeft}
          windowRight={windowRight}
        />
      );
    }
    // Vector of pairs: elements are {kind:'struct', fields:{first, second}}
    if (first.kind === 'struct' && first.fields != null && 'first' in first.fields) {
      return <PairVectorViz name={name} values={values as PairVal[]} />;
    }
    // Adjacency list: elements are {kind:'array', values:[...]}
    return (
      <AdjListViz
        name={name}
        values={values as Array<{ kind: string; values: number[] }>}
      />
    );
  }
  if (rows !== undefined && cols !== undefined && Array.isArray(values[0])) {
    return (
      <Array2D
        name={name}
        values={values as number[][]}
        rows={rows}
        cols={cols}
        lastWrite={lastWrite}
      />
    );
  }
  return (
    <Array1D
      name={name}
      values={values as number[]}
      lastWrite={lastWrite}
      pointers={pointers}
      windowLeft={windowLeft}
      windowRight={windowRight}
    />
  );
}
