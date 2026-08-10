import { motion } from 'framer-motion';

const NODE_R = 14;
const H_GAP  = 48;
const V_GAP  = 44;

type AnyVal = number | { kind?: string; value?: unknown; fields?: Record<string, AnyVal> };

function fmtVal(v: AnyVal): string {
  if (v === null || v === undefined) return '?';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'object') return String(v);
  const o = v as { kind?: string; value?: unknown; fields?: Record<string, AnyVal> };
  if (o.kind === 'int') return String(o.value ?? 0);
  if (o.kind === 'char') return String(o.value ?? '');
  // pair / tuple (e.g. a priority_queue<pair<int,int>> element): render the
  // fields as (a, b) rather than letting it stringify to "[object Object]".
  if (o.kind === 'struct' && o.fields) {
    return '(' + Object.values(o.fields).map(fmtVal).join(',') + ')';
  }
  return '?';
}

function toInt(v: AnyVal): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null) {
    const o = v as { value?: unknown };
    return typeof o.value === 'number' ? o.value : Number(o.value ?? 0);
  }
  return Number(v);
}

interface NodePos { x: number; y: number; idx: number }

function layoutHeap(n: number, containerW: number): NodePos[] {
  if (n === 0) return [];
  const positions: NodePos[] = [];
  const levels = Math.ceil(Math.log2(n + 1));
  for (let i = 0; i < n; i++) {
    const level   = Math.floor(Math.log2(i + 1));
    const nodesInLevel = Math.pow(2, level);
    const posInLevel   = i - (nodesInLevel - 1);
    const spacing  = containerW / (nodesInLevel + 1);
    const x = spacing * (posInLevel + 1);
    const y = (level + 1) * V_GAP;
    positions.push({ x, y, idx: i });
  }
  return positions;
}

export default function HeapTreeViz({
  name,
  values,
  lastWrite,
  isMinHeap = false,
}: {
  name: string;
  values: AnyVal[];
  lastWrite?: number[];
  isMinHeap?: boolean;
}) {
  const n   = values.length;
  const W   = Math.max(220, Math.min(360, H_GAP * Math.pow(2, Math.ceil(Math.log2(n + 1)) - 1)));
  const H   = (Math.ceil(Math.log2(n + 1)) + 1) * V_GAP + NODE_R;
  const positions = layoutHeap(n, W);
  const hiIdx = lastWrite?.[0] ?? -1;

  return (
    <div className="mt-1.5 mb-0.5">
      <div className="text-[9px] font-mono text-zinc-600 mb-1">
        {name}
        <span className="text-zinc-700 ml-1">{isMinHeap ? 'min-heap' : 'max-heap'}[{n}]</span>
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
          {/* Edges */}
          {positions.map(({ x, y, idx }) => {
            if (idx === 0) return null;
            const parentIdx = Math.floor((idx - 1) / 2);
            const parent = positions[parentIdx];
            return (
              <line
                key={`e${idx}`}
                x1={parent.x} y1={parent.y}
                x2={x} y2={y}
                stroke="rgba(99,102,241,0.25)"
                strokeWidth={1.5}
              />
            );
          })}
          {/* Nodes */}
          {positions.map(({ x, y, idx }) => {
            const isHi   = idx === hiIdx;
            const isRoot = idx === 0;
            const val    = values[idx];
            return (
              <g key={`n${idx}`}>
                <motion.circle
                  cx={x} cy={y} r={NODE_R}
                  animate={{
                    fill: isHi
                      ? 'rgba(251,191,36,0.25)'
                      : isRoot
                        ? 'rgba(99,102,241,0.2)'
                        : 'rgba(24,24,27,0.9)',
                    stroke: isHi
                      ? 'rgba(251,191,36,0.7)'
                      : isRoot
                        ? 'rgba(129,140,248,0.6)'
                        : 'rgba(63,63,70,0.6)',
                  }}
                  transition={{ duration: 0.25 }}
                  strokeWidth={1.5}
                />
                <text
                  x={x} y={y + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  style={{
                    fontSize: 9,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    fill: isHi ? '#fbbf24' : isRoot ? '#a5b4fc' : '#a1a1aa',
                    userSelect: 'none',
                  }}
                >
                  {fmtVal(val)}
                </text>
                {/* Index label below */}
                <text
                  x={x} y={y + NODE_R + 7}
                  textAnchor="middle"
                  style={{
                    fontSize: 7,
                    fontFamily: 'monospace',
                    fill: '#3f3f46',
                    userSelect: 'none',
                  }}
                >
                  {idx}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
