import { motion } from 'framer-motion';
import { GraphDescriptor, ExecutionDescriptor } from '../../types/trace';

// TRACE_CONTRACT_v2, slice 1 — pure renderer.
//
// GraphViz draws the interpreter-declared GraphDescriptor and ExecutionDescriptor
// 1:1. It performs ZERO inference: it does not detect that a structure is a
// graph, does not decide which object is the frontier, and does not read raw
// memory. Structure (nodes/edges/directedness) and roles (current/frontier/
// visited) are facts declared per step by the backend semantic-view resolver.

// ── Layout helpers ─────────────────────────────────────────────────────

function circularPos(n: number, cx: number, cy: number, r: number) {
  return Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / n - Math.PI / 2),
    y: cy + r * Math.sin((2 * Math.PI * i) / n - Math.PI / 2),
  }));
}

function shrinkEndpoints(
  x1: number, y1: number, x2: number, y2: number, amount: number,
) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  return {
    x1: x1 + ux * amount, y1: y1 + uy * amount,
    x2: x2 - ux * amount, y2: y2 - uy * amount,
  };
}

// ── Constants ──────────────────────────────────────────────────────────

const NODE_R = 17;

// ── Component ──────────────────────────────────────────────────────────

export default function GraphViz({
  graph,
  execution,
}: {
  graph: GraphDescriptor;
  execution?: ExecutionDescriptor | null;
}) {
  const { nodes, edges, directed } = graph;
  const n = nodes.length;

  // Node id → layout slot. Slice-1 nodes are 0..n-1, but map explicitly so
  // arbitrary node ids (later slices) render correctly.
  const slotOf = new Map<number, number>();
  nodes.forEach((id, i) => slotOf.set(id, i));

  const current  = execution?.current ?? null;
  const parent   = execution?.parent ?? null;
  const visitedSet  = new Set(execution?.visited ?? []);
  const frontierSet = new Set(execution?.frontier?.members ?? []);
  const algorithm   = execution?.algorithm ?? null;
  const hasWeights  = edges.some(e => e.w !== undefined);

  const W = 340;
  const H = n <= 4 ? 230 : n <= 6 ? 270 : n <= 8 ? 300 : 330;
  const cx = W / 2;
  const cy = H / 2;
  const layoutR = n <= 3 ? 72 : n <= 4 ? 86 : n <= 6 ? 100 : n <= 8 ? 112 : 125;

  const pos = circularPos(n, cx, cy, layoutR);
  const posOf = (id: number) => pos[slotOf.get(id) ?? 0];

  const edgeColor  = 'rgba(99,102,241,0.22)';
  const activeEdge = 'rgba(251,191,36,0.85)';

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[9px] font-mono text-zinc-600 tracking-wide">
          {n} nodes · {directed ? 'directed' : 'undirected'} graph
        </span>
        {algorithm && (
          <span className="text-[8px] font-mono text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-700/60 bg-zinc-800/40">
            {algorithm}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {visitedSet.size > 0 && <Legend color="rgba(34,197,94,0.7)" label="visited" />}
          {frontierSet.size > 0 && (
            <Legend color="rgba(56,189,248,0.85)" label={execution?.frontier?.kind === 'stack' ? 'on stack' : 'in queue'} />
          )}
          {current !== null && <Legend color="#fbbf24" label="active" />}
        </div>
      </div>

      <svg
        width={W}
        height={H}
        style={{ fontFamily: "'JetBrains Mono', monospace", overflow: 'visible' }}
      >
        <defs>
          <marker id="gv-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0.5 L6,3 L0,5.5 Z" fill={edgeColor} />
          </marker>
          <marker id="gv-arrow-active" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0.5 L6,3 L0,5.5 Z" fill={activeEdge} />
          </marker>
        </defs>

        {/* ── Edges ── */}
        {edges.map((e, idx) => {
          const a = posOf(e.u);
          const b = posOf(e.v);
          if (!a || !b) return null;

          const isActive =
            (e.u === current && e.v === parent) ||
            (!directed && e.v === current && e.u === parent);

          const ep = shrinkEndpoints(a.x, a.y, b.x, b.y, NODE_R + 2);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;

          return (
            <g key={`e${idx}-${e.u}-${e.v}`}>
              <motion.line
                x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2}
                animate={{
                  stroke:      isActive ? activeEdge : edgeColor,
                  strokeWidth: isActive ? 2.5 : 1.5,
                  opacity:     isActive ? 1 : 0.9,
                }}
                transition={{ duration: 0.28 }}
                strokeLinecap="round"
                markerEnd={directed ? (isActive ? 'url(#gv-arrow-active)' : 'url(#gv-arrow)') : undefined}
              />
              {e.w !== undefined && (
                <text
                  x={mx} y={my - 5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={8}
                  fill={isActive ? '#fbbf24' : 'rgba(161,161,170,0.7)'}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {e.w}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Nodes ── */}
        {nodes.map((id, i) => {
          const p = pos[i];
          const isVisited  = visitedSet.has(id);
          const isCurrent  = id === current;
          const isParent   = id === parent;
          // A node waiting in the frontier (the wavefront). Since BFS marks
          // nodes visited as it enqueues them, "in queue" distinguishes nodes
          // still waiting from nodes already processed (dequeued).
          const isFrontier = frontierSet.has(id) && !isCurrent;

          const fill   = isCurrent  ? 'rgba(251,191,36,0.16)' :
                         isFrontier ? 'rgba(56,189,248,0.16)' :
                         isParent   ? 'rgba(99,102,241,0.16)' :
                         isVisited  ? 'rgba(34,197,94,0.10)' :
                         'rgba(15,15,20,0.95)';
          const stroke = isCurrent  ? '#fbbf24' :
                         isFrontier ? 'rgba(56,189,248,0.85)' :
                         isParent   ? 'rgba(129,140,248,0.75)' :
                         isVisited  ? 'rgba(34,197,94,0.55)' :
                         'rgba(63,63,70,0.45)';
          const textFill = isCurrent  ? '#fbbf24' :
                           isFrontier ? '#7dd3fc' :
                           isVisited  ? '#86efac' :
                           '#52525b';

          return (
            <g key={`n${id}`}>
              {/* Outer glow ring — always rendered, opacity-animated */}
              <motion.circle
                cx={p.x} cy={p.y} r={NODE_R + 7}
                fill="none"
                animate={{
                  stroke: isCurrent ? 'rgba(251,191,36,0.18)' : 'transparent',
                  strokeWidth: isCurrent ? 9 : 0,
                }}
                transition={{ duration: 0.28 }}
              />

              {/* Main circle */}
              <motion.circle
                cx={p.x} cy={p.y} r={NODE_R}
                animate={{ fill, stroke, strokeWidth: isCurrent ? 2 : 1.5 }}
                transition={{ duration: 0.28 }}
              />

              {/* Node id */}
              <text
                x={p.x}
                y={p.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fill={textFill}
                fontWeight={isCurrent ? 'bold' : 'normal'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {id}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Weighted-graph hint (kept subtle; weights render on the edges) */}
      {hasWeights && (
        <span className="text-[8px] font-mono text-zinc-700 mt-1">weighted</span>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      <span className="text-[8px] font-mono text-zinc-700">{label}</span>
    </div>
  );
}
