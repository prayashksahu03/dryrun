import { motion } from 'framer-motion';

const CELL_W = 32;
const CELL_H = 28;
const ARC_MAX_H = 40;

type AnyVal = number | { kind?: string; value?: unknown };

function toInt(v: AnyVal): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null) {
    const o = v as { value?: unknown };
    return typeof o.value === 'number' ? o.value : Number(o.value ?? 0);
  }
  return Number(v);
}

function fmtVal(v: AnyVal): string {
  if (v === null || v === undefined) return '?';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'object') return String(v);
  const o = v as { kind?: string; value?: unknown };
  if (o.kind === 'int') return String(o.value ?? 0);
  return String(v);
}

// lowbit(i) = i & (-i) — how many elements this BIT cell covers
function lowbit(i: number): number {
  return i & (-i);
}

export default function BITViz({
  name,
  values,
  lastWrite,
}: {
  name: string;
  values: AnyVal[];
  lastWrite?: number[];
}) {
  // BIT is 1-indexed; treat index 0 as unused sentinel
  const n = values.length;
  const hiIdx = lastWrite?.[0] ?? -1;

  // Total width: cell for each index
  const totalW = n * CELL_W + 8;
  const svgH = ARC_MAX_H + CELL_H + 32; // arcs above + cell + index labels

  // Build arc segments: for each 1-based index i, the arc spans [i - lowbit(i) + 1, i]
  const arcs: Array<{ start: number; end: number; idx: number; depth: number }> = [];
  // depth: number of bits set in lowbit level — use log2(lowbit) to layer arcs
  for (let i = 1; i < n; i++) {
    const lb = lowbit(i);
    const start = i - lb; // 0-based left (exclusive)
    const end   = i;      // 0-based right (inclusive)
    const depth = Math.round(Math.log2(lb));
    arcs.push({ start, end, idx: i, depth });
  }
  const maxDepth = arcs.reduce((m, a) => Math.max(m, a.depth), 0);

  return (
    <div className="mt-1.5 mb-0.5">
      <div className="text-[9px] font-mono text-zinc-600 mb-1">
        {name}
        <span className="text-zinc-700 ml-1">BIT[{n}]</span>
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <svg
          width={totalW}
          height={svgH}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {/* Arc overlays showing BIT responsibility ranges */}
          {arcs.map(({ start, end, idx, depth }) => {
            const isHi = idx === hiIdx;
            // x positions: offset from left edge, 0-indexed cells
            const x1 = start * CELL_W + CELL_W / 2 + 4;
            const x2 = end   * CELL_W - CELL_W / 2 + 4;
            const arcH = (depth + 1) * (ARC_MAX_H / (maxDepth + 1));
            const mx = (x1 + x2) / 2;
            const cy = ARC_MAX_H - arcH;
            const color = isHi
              ? 'rgba(251,191,36,0.7)'
              : `rgba(99,102,241,${0.12 + depth * 0.1})`;
            return (
              <path
                key={`arc${idx}`}
                d={`M ${x1} ${ARC_MAX_H} Q ${mx} ${cy} ${x2} ${ARC_MAX_H}`}
                fill="none"
                stroke={color}
                strokeWidth={isHi ? 1.5 : 1}
              />
            );
          })}

          {/* Cells */}
          {Array.from({ length: n }, (_, i) => {
            const isHi = i === hiIdx;
            const isUsed = i > 0; // index 0 unused in 1-indexed BIT
            const x = i * CELL_W + 4;
            const y = ARC_MAX_H + 4;
            const bgColor = isHi
              ? 'rgba(251,191,36,0.18)'
              : isUsed
                ? 'rgba(24,24,27,0.9)'
                : 'rgba(15,15,20,0.6)';
            const bdColor = isHi
              ? 'rgba(251,191,36,0.6)'
              : isUsed
                ? 'rgba(63,63,70,0.5)'
                : 'rgba(40,40,48,0.4)';
            const txtColor = isHi ? '#fbbf24' : isUsed ? '#a1a1aa' : '#52525b';
            return (
              <g key={`c${i}`}>
                <motion.rect
                  x={x} y={y}
                  width={CELL_W - 1} height={CELL_H}
                  rx={2}
                  animate={{ fill: bgColor, stroke: bdColor }}
                  transition={{ duration: 0.2 }}
                  strokeWidth={1}
                />
                <text
                  x={x + (CELL_W - 1) / 2} y={y + CELL_H / 2 + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  style={{
                    fontSize: 9,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    fill: txtColor,
                    userSelect: 'none',
                  }}
                >
                  {isUsed ? fmtVal(values[i]) : '·'}
                </text>
                {/* Index label */}
                <text
                  x={x + (CELL_W - 1) / 2} y={y + CELL_H + 9}
                  textAnchor="middle"
                  style={{
                    fontSize: 7,
                    fontFamily: 'monospace',
                    fill: '#3f3f46',
                    userSelect: 'none',
                  }}
                >
                  {i}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
