import { useMemo } from 'react';
import { VariableValue } from '../../types/trace';

// ── Layout constants ──────────────────────────────────────────────────────
const NODE_W  = 72;
const NODE_H  = 48;
const H_GAP   = 14;
const V_GAP   = 52;
const PAD     = 10;

// ── Node data ─────────────────────────────────────────────────────────────
interface STNode {
  v:     number;
  vl:    number;
  vr:    number;
  value: number;
  lazy:  number;
  cx:    number;
  cy:    number;
  left?:  STNode;
  right?: STNode;
}

// ── Tree builder ──────────────────────────────────────────────────────────
function buildLayout(
  n:         number,
  treeArr:   number[],
  lazyArr:   number[],
  indexBase: 0 | 1 = 1,
): { root: STNode; svgW: number; svgH: number } {
  let leafIdx = 0;

  const leftChild  = (v: number) => indexBase === 1 ? 2 * v     : 2 * v + 1;
  const rightChild = (v: number) => indexBase === 1 ? 2 * v + 1 : 2 * v + 2;
  const rootV  = indexBase;
  const rangeL = indexBase;
  const rangeR = indexBase + n - 1;

  function build(v: number, vl: number, vr: number, depth: number): STNode {
    const node: STNode = {
      v, vl, vr,
      value: treeArr[v] ?? 0,
      lazy:  lazyArr[v]  ?? 0,
      cx: 0,
      cy: depth * (NODE_H + V_GAP),
    };
    if (vl === vr) {
      node.cx = leafIdx * (NODE_W + H_GAP) + NODE_W / 2;
      leafIdx++;
    } else {
      const mid = Math.floor((vl + vr) / 2);
      node.left  = build(leftChild(v),  vl,      mid, depth + 1);
      node.right = build(rightChild(v), mid + 1, vr,  depth + 1);
      node.cx = (node.left.cx + node.right.cx) / 2;
    }
    return node;
  }

  const root = build(rootV, rangeL, rangeR, 0);

  function treeHeight(nd: STNode): number {
    if (!nd.left && !nd.right) return 0;
    return 1 + Math.max(
      nd.left  ? treeHeight(nd.left)  : 0,
      nd.right ? treeHeight(nd.right) : 0,
    );
  }

  const depth = treeHeight(root);
  const svgW  = leafIdx * (NODE_W + H_GAP) - H_GAP;
  const svgH  = (depth + 1) * (NODE_H + V_GAP) - V_GAP;

  return { root, svgW, svgH };
}

// ── Flatten tree into edge / node lists ───────────────────────────────────
interface Edge { x1: number; y1: number; x2: number; y2: number }

function collect(root: STNode): { nodes: STNode[]; edges: Edge[] } {
  const nodes: STNode[] = [];
  const edges: Edge[]   = [];

  function walk(nd: STNode) {
    nodes.push(nd);
    if (nd.left) {
      edges.push({ x1: nd.cx, y1: nd.cy + NODE_H, x2: nd.left.cx,  y2: nd.left.cy  });
      walk(nd.left);
    }
    if (nd.right) {
      edges.push({ x1: nd.cx, y1: nd.cy + NODE_H, x2: nd.right.cx, y2: nd.right.cy });
      walk(nd.right);
    }
  }
  walk(root);
  return { nodes, edges };
}

// ── Value extractor ────────────────────────────────────────────────────────
function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'value' in v) return Number((v as { value: unknown }).value);
  return 0;
}

// ── Main component ────────────────────────────────────────────────────────
export default function SegTreeViz({
  name,
  value,
  prevValue,
  treeFieldName = 'tree',
  nOverride,
  indexBase = 1,
  rawTreeArr,
  rawPrevTreeArr,
}: {
  name:            string;
  value?:          VariableValue & { kind: 'struct' };
  prevValue?:      VariableValue;
  treeFieldName?:  string;
  nOverride?:      number;
  indexBase?:      0 | 1;
  rawTreeArr?:     number[];   // bypass struct lookup — standalone array segtree
  rawPrevTreeArr?: number[];
}) {
  const nField    = value?.fields.n;
  const treeField = value ? (value.fields[treeFieldName] ?? value.fields.tree ?? value.fields.seg) : null;
  const lazyField = value?.fields.lazy;

  const n = nOverride ?? (nField?.kind === 'int' ? nField.value : 0);

  const treeArr = useMemo(() => {
    if (rawTreeArr) return rawTreeArr;
    if (!treeField || treeField.kind !== 'array') return [];
    return (treeField.values as unknown[]).map(toNum);
  }, [rawTreeArr, treeField]);

  const lazyArr = useMemo(() => {
    if (!lazyField || lazyField.kind !== 'array') return [];
    return (lazyField.values as unknown[]).map(toNum);
  }, [lazyField]);

  const prevTreeArr = useMemo(() => {
    if (rawPrevTreeArr) return rawPrevTreeArr;
    if (!prevValue || prevValue.kind !== 'struct') return null;
    const pt = prevValue.fields[treeFieldName] ?? prevValue.fields.tree ?? prevValue.fields.seg;
    if (!pt || pt.kind !== 'array') return null;
    return (pt.values as unknown[]).map(toNum);
  }, [rawPrevTreeArr, prevValue, treeFieldName]);

  const layout = useMemo(
    () => (n > 0 ? buildLayout(n, treeArr, lazyArr, indexBase) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, treeArr.join(','), lazyArr.join(','), indexBase],
  );

  if (!layout) return null;
  const { root, svgW, svgH } = layout;
  const { nodes, edges } = collect(root);

  return (
    <div className="mt-2 mb-2 select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[9px] font-mono text-zinc-500">
          {name}
          <span className="text-zinc-600 ml-1">[n={n}]</span>
        </span>
        <span
          className="text-[8px] font-mono px-1.5 rounded"
          style={{ color: 'rgba(236,72,153,0.7)', border: '1px solid rgba(236,72,153,0.25)' }}
        >
          segtree
        </span>
      </div>

      {/* SVG tree */}
      <div className="overflow-x-auto rounded-md pb-1" style={{ maxWidth: '100%' }}>
        <svg width={svgW + PAD * 2} height={svgH + PAD * 2} style={{ display: 'block' }}>
          <g transform={`translate(${PAD},${PAD})`}>

            {edges.map((e, i) => (
              <line
                key={i}
                x1={e.x1} y1={e.y1 + 3}
                x2={e.x2} y2={e.y2 - 3}
                stroke="rgba(99,102,241,0.22)"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            ))}

            {nodes.map(nd => {
              const hasLazy = nd.lazy !== 0;
              const changed = prevTreeArr != null && (prevTreeArr[nd.v] ?? 0) !== nd.value;
              const isLeaf  = !nd.left && !nd.right;

              const fillC   = changed ? 'rgba(34,197,94,0.13)'
                            : hasLazy ? 'rgba(245,158,11,0.13)'
                            : isLeaf  ? 'rgba(99,102,241,0.09)'
                            :            'rgba(99,102,241,0.05)';
              const strokeC = changed ? 'rgba(34,197,94,0.55)'
                            : hasLazy ? 'rgba(245,158,11,0.5)'
                            : isLeaf  ? 'rgba(99,102,241,0.35)'
                            :            'rgba(99,102,241,0.22)';
              const valCol  = changed ? '#86efac' : '#fcd34d';

              const nx = nd.cx - NODE_W / 2;
              const ny = nd.cy;

              return (
                <g key={nd.v}>
                  <rect x={nx} y={ny} width={NODE_W} height={NODE_H} rx={5}
                    fill={fillC} stroke={strokeC} strokeWidth={1} />

                  <text x={nd.cx} y={ny + 13} textAnchor="middle"
                    fontSize={9} fontFamily="monospace" fill="rgba(165,180,252,0.6)">
                    [{nd.vl},{nd.vr}]
                  </text>

                  <text x={nd.cx} y={ny + 31} textAnchor="middle"
                    fontSize={13} fontWeight="600" fontFamily="monospace" fill={valCol}>
                    {nd.value}
                  </text>

                  {hasLazy && (
                    <>
                      <rect x={nx + NODE_W - 23} y={ny + 2} width={21} height={13} rx={3}
                        fill="rgba(245,158,11,0.2)" stroke="rgba(245,158,11,0.45)" strokeWidth={0.75} />
                      <text x={nx + NODE_W - 12} y={ny + 12} textAnchor="middle"
                        fontSize={8} fontFamily="monospace" fill="#f59e0b">
                        +{nd.lazy}
                      </text>
                    </>
                  )}

                  <text x={nx + 4} y={ny + NODE_H - 3}
                    fontSize={7} fontFamily="monospace" fill="rgba(99,102,241,0.35)">
                    v{nd.v}
                  </text>
                </g>
              );
            })}

          </g>
        </svg>
      </div>
    </div>
  );
}
