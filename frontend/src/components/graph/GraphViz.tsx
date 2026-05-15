import { motion } from 'framer-motion';
import { MemorySnapshot } from '../../types/trace';

// ── Detection ──────────────────────────────────────────────────────────
//
// Heuristics for "this is an adjacency matrix":
//   1. Square 2D array (rows == cols), size 2..12
//   2. Every value is 0 or 1
//   3. Diagonal is all 0  (no self-loops)
//
// Directed vs undirected: adj[i][j] == adj[j][i] for all i,j → undirected.
// Visited array: 1D array of same length with only 0/1 values.
// DFS state: `node` and `parent` int variables in the innermost frame.

export interface GraphData {
  n: number;
  adj: number[][];
  directed: boolean;
  visited: number[] | null;
  currentNode: number | null;
  parentNode: number | null;
  edgeWeights?: number[][];
}

function* iterFrameArrays(memory: MemorySnapshot, skip?: Set<string>) {
  for (const frame of memory.stack) {
    for (const [name, val] of Object.entries(frame.variables)) {
      if (!skip?.has(name)) yield { name, val };
      // Also yield arrays nested one level inside structs (C++ class fields)
      if (val.kind === 'struct' && val.fields) {
        for (const [fname, fv] of Object.entries(val.fields as Record<string, typeof val>)) {
          yield { name: `${name}.${fname}`, val: fv };
        }
      }
    }
  }
}

const CURRENT_NODE_VARS = ['u', 'node', 'curr', 'current', 'v', 'src', 'source', 'vertex', 'start'];
const PARENT_NODE_VARS  = ['parent', 'prev', 'p', 'par'];

function findTraversalState(memory: MemorySnapshot, n: number) {
  // ── visited / dist array (length n, all 0|1) ──
  let visited: number[] | null = null;
  for (const f of memory.stack) {
    for (const vval of Object.values(f.variables)) {
      if (vval.kind !== 'array' || vval.rows) continue;
      const arr = vval.values as number[];
      if (!Array.isArray(arr) || arr.length !== n) continue;
      if (arr.every(v => v === 0 || v === 1)) { visited = arr; break; }
    }
    if (visited) break;
  }

  // ── current node from innermost frame ──
  let currentNode: number | null = null;
  let parentNode:  number | null = null;
  const innermost = memory.stack[memory.stack.length - 1];
  if (innermost) {
    for (const name of CURRENT_NODE_VARS) {
      const nv = innermost.variables[name];
      if (nv?.kind === 'int' && nv.value >= 0 && nv.value < n) {
        currentNode = nv.value;
        break;
      }
    }
    for (const name of PARENT_NODE_VARS) {
      const pv = innermost.variables[name];
      if (pv?.kind === 'int' && pv.value >= 0 && pv.value < n) {
        parentNode = pv.value;
        break;
      }
    }
  }

  return { visited, currentNode, parentNode };
}

export function detectGraph(
  memory: MemorySnapshot,
  options?: { skip?: Set<string>; pairDestFields?: Record<string, 'first' | 'second'> },
): GraphData | null {
  const skip = options?.skip;
  const pairDestFields = options?.pairDestFields ?? {};

  for (const { name, val } of iterFrameArrays(memory, skip)) {
    if (val.kind !== 'array') continue;

    let n: number;
    let mat: number[][];

    // ── Adjacency matrix: NxN array of 0/1, rows/cols set ──────────────
    if (val.rows && val.cols && val.rows === val.cols) {
      n = val.rows;
      if (n < 2 || n > 12) continue;
      const raw = val.values as number[][];
      if (!Array.isArray(raw) || raw.length !== n) continue;
      if (!raw.every(row => Array.isArray(row) && row.length >= n &&
                    row.slice(0, n).every(v => v === 0 || v === 1))) continue;
      mat = raw;

    // ── Adjacency list: 1D array of arrays, each element is neighbor list ──
    } else if (!val.rows && !val.cols) {
      type PairEl = { kind: 'struct'; fields: { first: { value: number }; second: { value: number } } };
      type InnerEl = number | PairEl;
      const outer = val.values as Array<{ kind: string; values: InnerEl[] }>;
      if (!Array.isArray(outer)) continue;
      n = outer.length;
      if (n < 2 || n > 12) continue;

      // Detect whether neighbors are plain ints or weighted pairs {first:weight, second:dest}
      const isPairNeighbors = outer.some(el =>
        el && el.kind === 'array' && Array.isArray(el.values) && el.values.length > 0 &&
        typeof el.values[0] === 'object' && (el.values[0] as PairEl)?.kind === 'struct',
      );

      // Determine which pair field is the node index by scanning ALL pairs.
      // Collect every first/second value; if any first is out of [0,n) → first can't be dest.
      let firstCanBeDest = true;
      let secondCanBeDest = true;
      for (const el of outer) {
        if (!el || el.kind !== 'array' || !Array.isArray(el.values)) continue;
        for (const nb of el.values) {
          if (typeof nb !== 'object' || nb.kind !== 'struct' || !nb.fields) continue;
          const fv = nb.fields.first?.value;
          const sv = nb.fields.second?.value;
          if (typeof fv === 'number' && (fv < 0 || fv >= n)) firstCanBeDest = false;
          if (typeof sv === 'number' && (sv < 0 || sv >= n)) secondCanBeDest = false;
        }
      }
      // User hint overrides auto-detection; fallback: prefer first unless ruled out
      const destField: 'first' | 'second' =
        pairDestFields[name] ??
        ((!firstCanBeDest && secondCanBeDest) ? 'second' : 'first');
      const weightField = destField === 'first' ? 'second' : 'first';

      const getNeighborDest = (v: InnerEl): number | null => {
        if (typeof v === 'number') return v >= 0 && v < n ? v : null;
        if (typeof v === 'object' && v.kind === 'struct' && v.fields) {
          const dest = v.fields[destField]?.value;
          return typeof dest === 'number' && dest >= 0 && dest < n ? dest : null;
        }
        return null;
      };
      const getNeighborWeight = (v: InnerEl): number => {
        if (typeof v === 'object' && v.kind === 'struct' && v.fields) {
          const w = v.fields[weightField]?.value;
          return typeof w === 'number' ? w : 1;
        }
        return 1;
      };

      // Every element must be an inner array whose neighbors resolve to valid node indices
      if (!outer.every(el =>
        el && el.kind === 'array' && Array.isArray(el.values) &&
        el.values.every(v => getNeighborDest(v) !== null),
      )) continue;

      // Build NxN adjacency matrix and weight matrix from neighbor lists
      mat = Array.from({ length: n }, () => new Array(n).fill(0));
      const wmat: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (const nb of outer[i].values) {
          const dest = getNeighborDest(nb);
          if (dest !== null) {
            mat[i][dest] = 1;
            wmat[i][dest] = getNeighborWeight(nb);
          }
        }
      }
      // Reject if no edges at all (empty graph not useful to show)
      if (mat.every(row => row.every(v => v === 0))) continue;

      const isSymmetricW = mat.every((row, i) =>
        row.slice(0, n).every((v, j) => v === mat[j]?.[i]),
      );

      const { visited: visW, currentNode: curW, parentNode: parW } = findTraversalState(memory, n);
      return {
        n, adj: mat, directed: !isSymmetricW,
        visited: visW, currentNode: curW, parentNode: parW,
        edgeWeights: isPairNeighbors ? wmat : undefined,
      };

    } else {
      continue;
    }

    const isSymmetric = mat.every((row, i) =>
      row.slice(0, n).every((v, j) => v === mat[j]?.[i]),
    );

    const { visited, currentNode, parentNode } = findTraversalState(memory, n);
    return { n, adj: mat, directed: !isSymmetric, visited, currentNode, parentNode };
  }
  return null;
}

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

export default function GraphViz({ data }: { data: GraphData }) {
  const { n, adj, directed, visited, currentNode, parentNode, edgeWeights } = data;

  const W = 340;
  const H = n <= 4 ? 230 : n <= 6 ? 270 : n <= 8 ? 300 : 330;
  const cx = W / 2;
  const cy = H / 2;
  const layoutR = n <= 3 ? 72 : n <= 4 ? 86 : n <= 6 ? 100 : n <= 8 ? 112 : 125;

  const pos = circularPos(n, cx, cy, layoutR);

  const edgeColor   = 'rgba(99,102,241,0.22)';
  const activeEdge  = 'rgba(251,191,36,0.85)';

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[9px] font-mono text-zinc-600 tracking-wide">
          {n} nodes · {directed ? 'directed' : 'undirected'} graph
        </span>
        <div className="flex items-center gap-2 ml-auto">
          {visited && <Legend color="rgba(34,197,94,0.7)" label="visited" />}
          {currentNode !== null && <Legend color="#fbbf24" label="active" />}
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
        {adj.flatMap((row, i) =>
          row.map((connected, j) => {
            if (!connected) return null;
            if (!directed && j <= i) return null; // skip duplicate in undirected

            const isActive =
              (i === currentNode && j === parentNode) ||
              (!directed && j === currentNode && i === parentNode);

            const ep = shrinkEndpoints(pos[i].x, pos[i].y, pos[j].x, pos[j].y, NODE_R + 2);

            const weight = edgeWeights?.[i]?.[j];
            const mx = (pos[i].x + pos[j].x) / 2;
            const my = (pos[i].y + pos[j].y) / 2;

            return (
              <g key={`e${i}-${j}`}>
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
                {weight !== undefined && (
                  <text
                    x={mx} y={my - 5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={8}
                    fill={isActive ? '#fbbf24' : 'rgba(161,161,170,0.7)'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {weight}
                  </text>
                )}
              </g>
            );
          }),
        )}

        {/* ── Nodes ── */}
        {pos.map((p, i) => {
          const isVisited  = visited ? visited[i] === 1 : false;
          const isCurrent  = i === currentNode;
          const isParent   = i === parentNode;

          const fill   = isCurrent ? 'rgba(251,191,36,0.16)' :
                         isParent  ? 'rgba(99,102,241,0.16)' :
                         isVisited ? 'rgba(34,197,94,0.10)' :
                         'rgba(15,15,20,0.95)';
          const stroke = isCurrent ? '#fbbf24' :
                         isParent  ? 'rgba(129,140,248,0.75)' :
                         isVisited ? 'rgba(34,197,94,0.55)' :
                         'rgba(63,63,70,0.45)';
          const textFill = isCurrent ? '#fbbf24' :
                           isVisited ? '#86efac' :
                           '#52525b';

          return (
            <g key={`n${i}`}>
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

              {/* Node index */}
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
                {i}
              </text>
            </g>
          );
        })}
      </svg>
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
