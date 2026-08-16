import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { HeapBlock, VariableValue } from '../../types/trace';
import { useRefRegistry } from '../../contexts/refRegistry';

// ── Layout constants ─────────────────────────────────────────────────

const NODE_W = 140;
const NODE_H = 88;
const X_GAP  = 28;
const Y_GAP  = 68;

// ── Tree data structures ─────────────────────────────────────────────

interface LayoutNode {
  addr: string;
  x: number;   // in-order index → pixel x
  y: number;   // depth → pixel y
  left: LayoutNode | null;
  right: LayoutNode | null;
}

function buildLayout(
  addr: string | null,
  heap: Record<string, HeapBlock>,
  depth: number,
  counter: { v: number },
  seen: Set<string> = new Set(),
): LayoutNode | null {
  if (!addr || !heap[addr] || seen.has(addr)) return null;  // guard cycles
  seen.add(addr);
  const block = heap[addr];
  const leftAddr  = ptrAddr(block.fields['left']);
  const rightAddr = ptrAddr(block.fields['right']);

  const left  = buildLayout(leftAddr,  heap, depth + 1, counter, seen);
  const right = buildLayout(rightAddr, heap, depth + 1, counter, seen);

  // Center a parent over its children so edges stay short and mostly vertical.
  // Leaves consume sequential horizontal slots; internal nodes sit at the
  // midpoint of their subtree, which keeps parent→child edges from crossing.
  const kids = [left, right].filter(Boolean) as LayoutNode[];
  const x = kids.length
    ? (kids[0].x + kids[kids.length - 1].x) / 2
    : counter.v++;

  return { addr, x, y: depth, left, right };
}

function ptrAddr(v: VariableValue | undefined): string | null {
  return v?.kind === 'pointer' ? v.address : null;
}

function findRoot(heap: Record<string, HeapBlock>): string | null {
  const children = new Set<string>();
  Object.values(heap).forEach(b => {
    const l = ptrAddr(b.fields['left']);
    const r = ptrAddr(b.fields['right']);
    if (l) children.add(l);
    if (r) children.add(r);
  });
  return (
    Object.entries(heap).find(
      ([addr, b]) => b.state === 'allocated' && !children.has(addr),
    )?.[0] ?? null
  );
}

function collectNodes(n: LayoutNode | null, out: LayoutNode[] = []): LayoutNode[] {
  if (!n) return out;
  collectNodes(n.left, out);
  out.push(n);
  collectNodes(n.right, out);
  return out;
}

function collectEdges(
  n: LayoutNode | null,
  out: [LayoutNode, LayoutNode, 'left' | 'right'][] = [],
): [LayoutNode, LayoutNode, 'left' | 'right'][] {
  if (!n) return out;
  if (n.left)  out.push([n, n.left,  'left']);
  if (n.right) out.push([n, n.right, 'right']);
  collectEdges(n.left,  out);
  collectEdges(n.right, out);
  return out;
}

// ── Single tree node card ─────────────────────────────────────────────

function TreeNodeCard({
  addr, block, isCrashTarget, isActive,
}: {
  addr: string;
  block: HeapBlock;
  isCrashTarget: boolean;
  isActive: boolean;
}) {
  const { register } = useRefRegistry();
  const ref = useRef<HTMLDivElement>(null);

  // Only register the block ref — NOT field refs — so ArrowLayer skips left/right fields
  useEffect(() => {
    register(`heap:${addr}`, ref.current);
    return () => register(`heap:${addr}`, null);
  });

  const isFreed = block.state === 'freed';
  const borderColor = isCrashTarget
    ? 'rgba(239,68,68,0.65)'
    : isActive
      ? 'rgba(251,191,36,0.75)'
      : isFreed
        ? 'rgba(63,63,70,0.5)'
        : 'rgba(34,197,94,0.28)';
  const bg = isCrashTarget
    ? 'rgba(239,68,68,0.07)'
    : isActive
      ? 'rgba(251,191,36,0.07)'
      : isFreed
        ? 'rgba(12,12,14,0.92)'
        : 'rgba(10,24,13,0.92)';

  // Find data field (non-pointer int)
  const dataEntry = Object.entries(block.fields).find(
    ([, v]) => v.kind === 'int',
  );
  const ptrEntries = Object.entries(block.fields).filter(
    ([, v]) => v.kind === 'pointer',
  );

  return (
    <motion.div
      ref={ref}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: isFreed ? 0.45 : 1,
        x: isCrashTarget ? [0, -5, 5, -5, 5, 0] : 0,
      }}
      transition={{ scale: { type: 'spring', stiffness: 300, damping: 22 }, x: { duration: 0.4 } }}
      className="relative rounded font-mono text-xs overflow-hidden"
      style={{ width: NODE_W, border: `1px solid ${borderColor}`, background: bg }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-2 py-1 border-b"
        style={{ borderColor, background: isCrashTarget ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.04)' }}
      >
        <span className="text-[10px] font-semibold text-green-400">{block.typeName}</span>
        <span className="text-[9px] text-zinc-600">{addr}</span>
      </div>

      {/* Active node pulse ring */}
      {isActive && (
        <motion.div
          className="absolute inset-0 rounded pointer-events-none"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ border: '2px solid rgba(251,191,36,0.5)', borderRadius: 4 }}
        />
      )}

      {/* Data value — large and centered */}
      {dataEntry && (
        <div className="flex flex-col items-center justify-center py-2 border-b" style={{ borderColor: isActive ? 'rgba(251,191,36,0.2)' : 'rgba(34,197,94,0.1)' }}>
          <span className="text-[9px] text-zinc-600 mb-0.5">{dataEntry[0]}</span>
          <span className={`text-xl font-bold leading-none ${isActive ? 'text-yellow-300' : 'text-amber-400'}`}>
            {dataEntry[1].kind === 'int' ? dataEntry[1].value : '?'}
          </span>
        </div>
      )}

      {/* Pointer fields — small, just show label */}
      <div className="px-2 py-1 space-y-0.5">
        {ptrEntries.map(([field, val]) => (
          <div key={field} className="flex items-center justify-between">
            <span className="text-[9px] text-zinc-600">{field}</span>
            <span className={`text-[9px] ${val.kind === 'pointer' && val.address ? 'text-cyan-500' : 'text-zinc-700'}`}>
              {val.kind === 'pointer' ? (val.address ?? 'NULL') : '?'}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-2 py-0.5 border-t text-[9px] text-zinc-700" style={{ borderColor: 'rgba(34,197,94,0.08)' }}>
        {block.size}B · alloc @ line {block.allocatedAtLine}
      </div>

      {isFreed && (
        <>
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.06) 0px, rgba(239,68,68,0.06) 1px, transparent 1px, transparent 9px)',
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <span className="text-[9px] font-bold text-red-500/50 tracking-[0.25em] uppercase">freed</span>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ── Tree edge SVG ─────────────────────────────────────────────────────

function EdgeSVG({
  edges,
  nodes,
}: {
  edges: [LayoutNode, LayoutNode, 'left' | 'right'][];
  nodes: LayoutNode[];
}) {
  const maxX = Math.max(...nodes.map(n => n.x), 0);
  const maxY = Math.max(...nodes.map(n => n.y), 0);
  const W = (maxX + 1) * (NODE_W + X_GAP) - X_GAP;
  const H = (maxY + 1) * (NODE_H + Y_GAP) - Y_GAP;

  const px = (x: number) => x * (NODE_W + X_GAP) + NODE_W / 2;
  const py = (y: number) => y * (NODE_H + Y_GAP);

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={W}
      height={H}
      style={{ overflow: 'visible' }}
    >
      {edges.map(([parent, child, side]) => {
        const isLeft = side === 'left';
        // Left edge leaves the parent's bottom-LEFT, right edge its bottom-RIGHT,
        // so which pointer goes where is obvious from geometry, not just the badge.
        const x1 = px(parent.x) + (isLeft ? -NODE_W * 0.28 : NODE_W * 0.28);
        const y1 = py(parent.y) + NODE_H;
        const x2 = px(child.x);
        const y2 = py(child.y);
        const cy1 = y1 + Y_GAP * 0.5;
        const cy2 = y2 - Y_GAP * 0.5;

        const color  = isLeft ? 'rgba(129,140,248,0.85)' : 'rgba(52,211,153,0.8)';
        const glow   = isLeft ? 'rgba(99,102,241,0.15)' : 'rgba(34,197,94,0.12)';
        const label  = isLeft ? 'L' : 'R';
        const lx = x1 + (x2 - x1) * 0.5;
        const ly = (y1 + y2) / 2;

        const d = `M ${x1} ${y1} C ${x1} ${cy1} ${x2} ${cy2} ${x2} ${y2}`;

        return (
          <g key={`${parent.addr}-${child.addr}`}>
            {/* Glow */}
            <path d={d} stroke={glow} strokeWidth={6} fill="none" strokeLinecap="round" />
            {/* Line */}
            <path d={d} stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" />
            {/* Arrowhead */}
            <polygon
              points={`${x2},${y2} ${x2 - 4},${y2 - 8} ${x2 + 4},${y2 - 8}`}
              fill={color}
            />
            {/* L / R badge */}
            <rect x={lx - 6} y={ly - 7} width={12} height={13} rx={3}
              fill={isLeft ? 'rgba(99,102,241,0.12)' : 'rgba(34,197,94,0.08)'}
              stroke={color} strokeWidth={0.5}
            />
            <text x={lx} y={ly + 3.5} fontSize={8} fill={color}
              fontFamily="monospace" textAnchor="middle" fontWeight="600">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Main export ───────────────────────────────────────────────────────

export default function TreeView({
  heap,
  crashAddr,
  currentNodeAddr,
}: {
  heap: Record<string, HeapBlock>;
  crashAddr: string | undefined;
  currentNodeAddr?: string | null;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const rootAddr = findRoot(heap);
  const tree     = rootAddr ? buildLayout(rootAddr, heap, 0, { v: 0 }) : null;
  const nodes    = collectNodes(tree);
  const edges    = collectEdges(tree);

  const maxX = nodes.length ? Math.max(...nodes.map(n => n.x)) : 0;
  const maxY = nodes.length ? Math.max(...nodes.map(n => n.y)) : 0;
  const W = (maxX + 1) * (NODE_W + X_GAP) - X_GAP;
  const H = (maxY + 1) * (NODE_H + Y_GAP) - Y_GAP;

  // Auto-scale to fit the parent container, never enlarge
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const compute = () => {
      const parent = el.parentElement;
      if (!parent) return;
      const availW = parent.clientWidth  - 16;
      const availH = parent.clientHeight - 16;
      const s = Math.min(availW / W, availH / H, 1);
      setScale(Math.max(s, 0.28));   // never smaller than 28%
    };

    compute();
    const ro = new ResizeObserver(compute);
    const parent = el.parentElement;
    if (parent) ro.observe(parent);
    return () => ro.disconnect();
  }, [W, H]);

  if (!rootAddr || !tree) {
    return <div className="text-zinc-800 text-xs font-mono">no heap allocations yet</div>;
  }

  const px = (x: number) => x * (NODE_W + X_GAP);
  const py = (y: number) => y * (NODE_H + Y_GAP);

  return (
    // Outer wrapper clips to scaled dimensions so it doesn't push other layout
    <div
      ref={wrapperRef}
      style={{ width: W * scale, height: H * scale, position: 'relative', flexShrink: 0 }}
    >
      {/* Scale indicator */}
      {scale < 0.99 && (
        <div
          className="absolute text-[8px] font-mono text-zinc-700 z-20 select-none"
          style={{ bottom: -14, right: 0 }}
        >
          {Math.round(scale * 100)}%
        </div>
      )}

      {/* Inner unscaled tree, transformed at origin */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: W,
          height: H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <EdgeSVG edges={edges} nodes={nodes} />
        {nodes.map(node => (
          <div
            key={node.addr}
            className="absolute"
            style={{ left: px(node.x), top: py(node.y), width: NODE_W }}
          >
            <TreeNodeCard
              addr={node.addr}
              block={heap[node.addr]}
              isCrashTarget={node.addr === crashAddr}
              isActive={node.addr === currentNodeAddr}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
