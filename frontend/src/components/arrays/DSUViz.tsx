import { motion } from 'framer-motion';

const NODE_R = 13;
const V_GAP  = 52;
const H_GAP  = 34;

type AnyVal = number | { kind?: string; value?: unknown };

function toInt(v: AnyVal): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null) {
    const o = v as { value?: unknown };
    return typeof o.value === 'number' ? o.value : Number(o.value ?? 0);
  }
  return Number(v);
}

interface NodePos { x: number; y: number; id: number }

function layoutForest(
  parent: number[],
  roots: number[],
  containerW: number,
): NodePos[] {
  const positions: NodePos[] = new Array(parent.length);

  // BFS subtree sizing per root
  function subtreeSize(node: number, children: Map<number, number[]>): number {
    const ch = children.get(node) ?? [];
    if (!ch.length) return 1;
    return ch.reduce((s, c) => s + subtreeSize(c, children), 0);
  }

  const children = new Map<number, number[]>();
  for (let i = 0; i < parent.length; i++) {
    if (parent[i] !== i) {
      const p = parent[i];
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(i);
    }
  }

  // Assign x positions: spread trees evenly
  let cursor = H_GAP;
  for (const root of roots) {
    placeSubtree(root, cursor, 0, children, positions);
    cursor += subtreeSize(root, children) * H_GAP + H_GAP;
  }

  return positions;
}

function placeSubtree(
  node: number,
  x: number,
  depth: number,
  children: Map<number, number[]>,
  out: NodePos[],
) {
  out[node] = { x, y: (depth + 1) * V_GAP, id: node };
  const ch = children.get(node) ?? [];
  let cx = x - ((ch.length - 1) * H_GAP) / 2;
  for (const child of ch) {
    placeSubtree(child, cx, depth + 1, children, out);
    cx += H_GAP;
  }
}

export default function DSUViz({
  name,
  values,
  lastWrite,
}: {
  name: string;
  values: AnyVal[];
  lastWrite?: number[];
}) {
  const n = values.length;
  const parent = values.map(toInt);

  // Detect roots (where parent[i] == i)
  const roots = parent.map((p, i) => (p === i ? i : -1)).filter(i => i >= 0);

  // Build a children map and compute positions
  const children = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (parent[i] !== i) {
      const p = parent[i];
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(i);
    }
  }

  function subtreeWidth(node: number): number {
    const ch = children.get(node) ?? [];
    if (!ch.length) return 1;
    return ch.reduce((s, c) => s + subtreeWidth(c), 0);
  }

  const totalWidth = roots.reduce((s, r) => s + subtreeWidth(r), 0);
  const W = Math.max(220, totalWidth * H_GAP + H_GAP * (roots.length + 1));
  const positions = layoutForest(parent, roots, W);
  const maxDepth = positions.reduce((m, p) => p ? Math.max(m, p.y) : m, 0);
  const H = maxDepth + NODE_R + 20;

  const hiIdx = lastWrite?.[0] ?? -1;

  return (
    <div className="mt-1.5 mb-0.5">
      <div className="text-[9px] font-mono text-zinc-600 mb-1">
        {name}
        <span className="text-zinc-700 ml-1">DSU[{n}]</span>
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
          {/* Edges from child to parent */}
          {Array.from({ length: n }, (_, i) => {
            if (parent[i] === i) return null;
            const from = positions[i];
            const to   = positions[parent[i]];
            if (!from || !to) return null;
            return (
              <line
                key={`e${i}`}
                x1={from.x} y1={from.y}
                x2={to.x}   y2={to.y}
                stroke="rgba(99,102,241,0.28)"
                strokeWidth={1.5}
              />
            );
          })}

          {/* Nodes */}
          {positions.map((pos, i) => {
            if (!pos) return null;
            const isRoot = parent[i] === i;
            const isHi   = i === hiIdx;
            return (
              <g key={`n${i}`}>
                <motion.circle
                  cx={pos.x} cy={pos.y} r={NODE_R}
                  animate={{
                    fill: isHi
                      ? 'rgba(251,191,36,0.25)'
                      : isRoot
                        ? 'rgba(99,102,241,0.22)'
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
                  x={pos.x} y={pos.y + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  style={{
                    fontSize: 9,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    fill: isHi ? '#fbbf24' : isRoot ? '#a5b4fc' : '#a1a1aa',
                    userSelect: 'none',
                  }}
                >
                  {i}
                </text>
                {/* Index label below */}
                <text
                  x={pos.x} y={pos.y + NODE_R + 7}
                  textAnchor="middle"
                  style={{
                    fontSize: 7,
                    fontFamily: 'monospace',
                    fill: '#3f3f46',
                    userSelect: 'none',
                  }}
                >
                  {isRoot ? '✓' : `→${parent[i]}`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
