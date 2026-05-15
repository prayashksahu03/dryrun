import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { HeapBlock, VariableValue } from '../../types/trace';

// ── Layout constants ──────────────────────────────────────────────────

const NODE_R  = 20;   // circle radius
const NODE_D  = NODE_R * 2;
const X_STEP  = 54;   // horizontal distance between adjacent leaves
const Y_STEP  = 76;   // vertical distance between depth levels
const PAD     = NODE_R + 4;

// ── Data model ────────────────────────────────────────────────────────

interface TNode {
  addr:     string;
  letter:   string;   // '' for root
  isEnd:    boolean;
  x:        number;   // pixel center X
  y:        number;   // pixel center Y
  children: TNode[];
}

function ptrAddr(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const vv = v as VariableValue;
  return vv.kind === 'pointer' ? (vv.address ?? null) : null;
}

// Recursively build the layout tree. Leaves get integer counter slots;
// internal nodes sit at the midpoint of their first and last child.
function buildTrie(
  addr: string,
  heap: Record<string, HeapBlock>,
  letter: string,
  depth: number,
  counter: { v: number },
): TNode {
  const block = heap[addr];
  const cf    = block?.fields['children'];
  const childNodes: TNode[] = [];

  if (cf?.kind === 'array') {
    (cf.values as VariableValue[]).forEach((v, i) => {
      const childAddr = ptrAddr(v);
      if (childAddr && heap[childAddr]?.state === 'allocated') {
        childNodes.push(
          buildTrie(childAddr, heap, String.fromCharCode(97 + i), depth + 1, counter),
        );
      }
    });
  }

  const isEnd = !!((block?.fields['isEnd'] as { kind: 'int'; value: number } | undefined)?.value);

  let x: number;
  if (childNodes.length === 0) {
    x = PAD + counter.v++ * X_STEP;
  } else {
    x = (childNodes[0].x + childNodes[childNodes.length - 1].x) / 2;
  }

  return { addr, letter, isEnd, x, y: PAD + depth * Y_STEP, children: childNodes };
}

export function findTrieRoot(heap: Record<string, HeapBlock>): string | null {
  const childAddrs = new Set<string>();
  for (const block of Object.values(heap)) {
    const cf = block.fields['children'];
    if (cf?.kind === 'array') {
      for (const v of cf.values as VariableValue[]) {
        const a = ptrAddr(v);
        if (a) childAddrs.add(a);
      }
    }
  }
  return (
    Object.entries(heap).find(
      ([addr, b]) =>
        b.state === 'allocated' &&
        b.fields['children']?.kind === 'array' &&
        !childAddrs.has(addr),
    )?.[0] ?? null
  );
}

function collectAll(n: TNode, out: TNode[] = []): TNode[] {
  out.push(n);
  n.children.forEach(c => collectAll(c, out));
  return out;
}

function collectEdges(n: TNode, out: [TNode, TNode][] = []): [TNode, TNode][] {
  n.children.forEach(c => { out.push([n, c]); collectEdges(c, out); });
  return out;
}

// ── Node circle ───────────────────────────────────────────────────────

function NodeCircle({
  node,
  isActive,
  isCrash,
}: {
  node:     TNode;
  isActive: boolean;
  isCrash:  boolean;
}) {
  const isRoot = node.letter === '';

  const borderColor = isCrash
    ? '#ef4444'
    : isActive
      ? '#fbbf24'
      : node.isEnd
        ? '#22c55e'
        : 'rgba(99,102,241,0.5)';

  const bg = isCrash
    ? 'rgba(239,68,68,0.18)'
    : isActive
      ? 'rgba(251,191,36,0.18)'
      : node.isEnd
        ? 'rgba(34,197,94,0.13)'
        : 'rgba(18,18,24,0.97)';

  const textColor = isCrash
    ? '#fca5a5'
    : isActive
      ? '#fde68a'
      : node.isEnd
        ? '#86efac'
        : isRoot
          ? 'rgba(99,102,241,0.35)'
          : '#c4b5fd';

  return (
    <motion.g
      key={node.addr}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      style={{ transformOrigin: `${node.x}px ${node.y}px` }}
    >
      {/* Outer glow for active / isEnd */}
      {(isActive || node.isEnd) && (
        <circle
          cx={node.x} cy={node.y} r={NODE_R + 5}
          fill="none"
          stroke={isActive ? 'rgba(251,191,36,0.25)' : 'rgba(34,197,94,0.18)'}
          strokeWidth={6}
        />
      )}

      {/* Main circle */}
      <circle
        cx={node.x} cy={node.y} r={NODE_R}
        fill={bg}
        stroke={borderColor}
        strokeWidth={node.isEnd ? 2 : 1.5}
      />

      {/* isEnd — small filled dot on the bottom edge */}
      {node.isEnd && (
        <circle cx={node.x} cy={node.y + NODE_R} r={3.5} fill="#22c55e" />
      )}

      {/* Letter */}
      <text
        x={node.x} y={node.y + 5}
        textAnchor="middle"
        fontSize={isRoot ? 10 : 14}
        fontWeight="700"
        fontFamily="ui-monospace, monospace"
        fill={textColor}
        style={{ userSelect: 'none' }}
      >
        {isRoot ? '∅' : node.letter}
      </text>
    </motion.g>
  );
}

// ── Main export ───────────────────────────────────────────────────────

export default function TrieView({
  heap,
  crashAddr,
  currentNodeAddr,
}: {
  heap:             Record<string, HeapBlock>;
  crashAddr?:       string;
  currentNodeAddr?: string | null;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const rootAddr = findTrieRoot(heap);
  if (!rootAddr) return <div className="text-zinc-800 text-xs font-mono">no trie yet</div>;

  const root     = buildTrie(rootAddr, heap, '', 0, { v: 0 });
  const allNodes = collectAll(root);
  const edges    = collectEdges(root);

  const maxX = Math.max(...allNodes.map(n => n.x));
  const maxY = Math.max(...allNodes.map(n => n.y));
  const W    = maxX + PAD;
  const H    = maxY + PAD + 8;

  useEffect(() => {
    const parent = wrapperRef.current?.parentElement;
    if (!parent) return;
    const compute = () => {
      const s = Math.min((parent.clientWidth - 24) / W, (parent.clientHeight - 24) / H, 1);
      setScale(Math.max(s, 0.28));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [W, H]);

  return (
    <div
      ref={wrapperRef}
      style={{ width: W * scale, height: H * scale, position: 'relative', flexShrink: 0 }}
    >
      {scale < 0.99 && (
        <div
          className="absolute text-[8px] font-mono text-zinc-700 z-20 select-none"
          style={{ bottom: -14, right: 0 }}
        >
          {Math.round(scale * 100)}%
        </div>
      )}

      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: W,
          height: H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          overflow: 'visible',
        }}
      >
        {/* Edges */}
        {edges.map(([parent, child]) => {
          const isChildActive = child.addr === currentNodeAddr;
          return (
            <line
              key={`${parent.addr}-${child.addr}`}
              x1={parent.x} y1={parent.y + NODE_R}
              x2={child.x}  y2={child.y  - NODE_R}
              stroke={isChildActive ? 'rgba(251,191,36,0.65)' : 'rgba(99,102,241,0.25)'}
              strokeWidth={isChildActive ? 2 : 1.5}
            />
          );
        })}

        {/* Nodes */}
        {allNodes.map(node => (
          <NodeCircle
            key={node.addr}
            node={node}
            isActive={node.addr === currentNodeAddr}
            isCrash={node.addr === crashAddr}
          />
        ))}
      </svg>

      {/* Legend */}
      <div
        className="absolute flex items-center gap-3 font-mono select-none"
        style={{ bottom: -20, left: 0 }}
      >
        <span className="flex items-center gap-1 text-[9px] text-indigo-400/60">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="none" stroke="rgba(99,102,241,0.5)" strokeWidth="1.5"/></svg>
          node
        </span>
        <span className="flex items-center gap-1 text-[9px] text-green-500/70">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="none" stroke="#22c55e" strokeWidth="2"/><circle cx="5" cy="9" r="2" fill="#22c55e"/></svg>
          word end
        </span>
        <span className="flex items-center gap-1 text-[9px] text-amber-400/70">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="rgba(251,191,36,0.18)" stroke="#fbbf24" strokeWidth="1.5"/></svg>
          current
        </span>
      </div>
    </div>
  );
}
