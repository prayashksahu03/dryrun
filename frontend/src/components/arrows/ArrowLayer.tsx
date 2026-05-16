import { useLayoutEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useRefRegistry } from '../../contexts/refRegistry';
import { useExecutionStore } from '../../store/executionStore';

interface Arrow {
  id: string;
  label: string;
  path: string;
  midX: number;
  midY: number;
  state: 'valid' | 'freed' | 'null';
}

function liftAmount(from: { x: number; y: number }, to: { x: number; y: number }) {
  return Math.max(70, Math.abs(to.x - from.x) * 0.65 + Math.abs(to.y - from.y) * 0.4);
}

// Three routing modes:
//  'above'         — arc up over the blocks (unused currently, kept for future)
//  'below'         — arc below the blocks (back-references, self-pointers)
//  forceVertical   — go straight down first, then curve (stack→heap)
//  default         — horizontal bezier (forward heap links)
function bezier(
  from: { x: number; y: number },
  to:   { x: number; y: number },
  arc?: 'above' | 'below',
  forceVertical?: boolean,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (arc === 'above') {
    const ctrlY = Math.min(from.y, to.y) - liftAmount(from, to);
    return `M ${from.x} ${from.y} C ${from.x} ${ctrlY}, ${to.x} ${ctrlY}, ${to.x} ${to.y}`;
  }

  if (arc === 'below') {
    const ctrlY = Math.max(from.y, to.y) + liftAmount(from, to);
    return `M ${from.x} ${from.y} C ${from.x} ${ctrlY}, ${to.x} ${ctrlY}, ${to.x} ${to.y}`;
  }

  // Stack→heap: go straight down first so the path stays in its own corridor above the blocks.
  if (forceVertical || Math.abs(dy) > Math.abs(dx) * 0.6) {
    const cy = Math.max(Math.abs(dy) * 0.45, 24);
    return `M ${from.x} ${from.y} C ${from.x} ${from.y + cy}, ${to.x} ${to.y - cy}, ${to.x} ${to.y}`;
  }

  // Heap→heap forward: horizontal S-curve.
  return `M ${from.x} ${from.y} C ${from.x + dx * 0.55} ${from.y}, ${from.x + dx * 0.45} ${to.y}, ${to.x} ${to.y}`;
}

// Bezier midpoint at t=0.5: 0.125*P0 + 0.375*P1 + 0.375*P2 + 0.125*P3
// For arc beziers both control points share ctrlY, so x_mid = (from.x+to.x)/2,
// y_mid = 0.125*(from.y+to.y) + 0.75*ctrlY. Offset label toward the inside of the arc.
function arcMid(
  from: { x: number; y: number },
  to:   { x: number; y: number },
  arc: 'above' | 'below',
): { x: number; y: number } {
  const lift  = liftAmount(from, to);
  const ctrlY = arc === 'above'
    ? Math.min(from.y, to.y) - lift
    : Math.max(from.y, to.y) + lift;
  return {
    x: (from.x + to.x) / 2,
    y: 0.125 * (from.y + to.y) + 0.75 * ctrlY + (arc === 'above' ? 14 : -14),
  };
}

function midpoint(from: { x: number; y: number }, to: { x: number; y: number }) {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function rectEdge(rect: DOMRect, side: 'left' | 'right' | 'top' | 'bottom', canvas: DOMRect) {
  switch (side) {
    case 'top':    return { x: rect.left + rect.width / 2 - canvas.left, y: rect.top    - canvas.top };
    case 'bottom': return { x: rect.left + rect.width / 2 - canvas.left, y: rect.bottom - canvas.top };
    default:       return { x: (side === 'right' ? rect.right : rect.left) - canvas.left, y: rect.top + rect.height / 2 - canvas.top };
  }
}

export default function ArrowLayer({ tick }: { tick: number }) {
  const { getEl, canvasRef } = useRefRegistry();
  const { currentFrame }      = useExecutionStore();
  const [arrows, setArrows]   = useState<Arrow[]>([]);

  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    if (canvasRect.width === 0) return;

    const frame = currentFrame();
    if (!frame) { setArrows([]); return; }

    const heap = frame.memory.heap;
    const computed: Arrow[] = [];

    const inCanvasBounds = (rect: DOMRect) =>
      rect.bottom >= canvasRect.top && rect.top <= canvasRect.bottom &&
      rect.right  >= canvasRect.left && rect.left <= canvasRect.right;

    const addArrow = (
      id: string,
      label: string,
      srcKey: string,
      targetAddr: string | null,
      isHeapArrow = false,
    ) => {
      const srcEl = getEl(srcKey);
      if (!srcEl) return;
      const srcRect = srcEl.getBoundingClientRect();
      if (!inCanvasBounds(srcRect)) return;

      const from = rectEdge(srcRect, 'right', canvasRect);

      if (!targetAddr) {
        const to  = { x: from.x + 18, y: from.y + 20 };
        const mid = midpoint(from, to);
        computed.push({ id, label, path: bezier(from, to), midX: mid.x, midY: mid.y - 6, state: 'null' });
        return;
      }

      const tgtEl = getEl(`heap:${targetAddr}`);
      if (!tgtEl) return;
      const tgtRect = tgtEl.getBoundingClientRect();
      if (!inCanvasBounds(tgtRect)) return;

      const isFreed   = heap[targetAddr]?.state === 'freed';
      const isSelf    = isHeapArrow && srcKey.startsWith(`heap:${targetAddr}:`);
      const isBackRef = isHeapArrow && !isSelf && tgtRect.right < srcRect.left;

      let to: { x: number; y: number };
      let mid: { x: number; y: number };
      let path: string;

      if (isSelf || isBackRef) {
        // ── Corridor 3: below the blocks ──────────────────────────────────
        // Arcs under the heap blocks — completely separate from the stack
        // arrows descending from above and the forward links at block level.
        to   = rectEdge(tgtRect, 'bottom', canvasRect);
        mid  = arcMid(from, to, 'below');
        path = bezier(from, to, 'below');

      } else if (!isHeapArrow) {
        // ── Corridor 1: stack→heap, descend from above ────────────────────
        // Go straight down first so both stack arrows stay in parallel lanes
        // without crossing the heap-to-heap forward links.
        to   = rectEdge(tgtRect, 'top', canvasRect);
        const rawMid = midpoint(from, to);
        mid  = { x: rawMid.x, y: rawMid.y - 8 };
        path = bezier(from, to, undefined, true /* forceVertical */);

      } else {
        // ── Corridor 2: heap→heap forward link ────────────────────────────
        // Horizontal at block level; land on left (or top when significantly below).
        const landOnTop = (tgtRect.top - srcRect.bottom) > 40;
        to   = rectEdge(tgtRect, landOnTop ? 'top' : 'left', canvasRect);
        const rawMid = midpoint(from, to);
        mid  = { x: rawMid.x, y: rawMid.y - 8 };
        path = bezier(from, to);
      }

      computed.push({ id, label, path, midX: mid.x, midY: mid.y, state: isFreed ? 'freed' : 'valid' });
    };

    // Only draw pointer arrows from the innermost (topmost) active frame.
    const stack = frame.memory.stack;
    const activeFrames = stack.length <= 1
      ? stack
      : [stack[0], stack[stack.length - 1]];

    activeFrames.forEach(sf => {
      Object.entries(sf.variables).forEach(([varName, val]) => {
        if (val.kind === 'pointer') {
          addArrow(`s:${sf.function}:${varName}`, varName, `stack:${sf.function}:${varName}`, val.address, false);
        }
      });
    });

    Object.entries(heap).forEach(([addr, block]) => {
      if (block.state === 'freed') return;
      Object.entries(block.fields).forEach(([field, val]) => {
        if (val.kind === 'pointer' && val.address !== null) {
          addArrow(`h:${addr}:${field}`, `→${field}`, `heap:${addr}:${field}`, val.address, true);
        }
      });
    });

    setArrows(computed);
  }, [tick, currentFrame, getEl, canvasRef]);

  const colorOf = (s: Arrow['state']) =>
    s === 'valid' ? '#22c55e' : s === 'freed' ? '#ef4444' : '#4b5563';

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-30"
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
    >
      <defs>
        {(['valid', 'freed', 'null'] as const).map(s => (
          <marker key={s} id={`ah-${s}`} markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M0,0.5 L6,3.5 L0,6.5 Z" fill={colorOf(s)} />
          </marker>
        ))}
      </defs>

      {arrows.map(arrow => {
        const color  = colorOf(arrow.state);
        const isDash = arrow.state === 'freed';
        return (
          <g key={arrow.id}>
            <motion.path d={arrow.path} animate={{ d: arrow.path }} transition={{ duration: 0.38, ease: 'easeInOut' }}
              stroke={color} strokeWidth={5} fill="none" opacity={0.10} strokeLinecap="round" />
            <motion.path d={arrow.path} animate={{ d: arrow.path }} transition={{ duration: 0.38, ease: 'easeInOut' }}
              stroke={color} strokeWidth={1.5} fill="none"
              strokeDasharray={isDash ? '5 3' : undefined}
              markerEnd={`url(#ah-${arrow.state})`}
              strokeLinecap="round" opacity={0.9} />
            <motion.text animate={{ x: arrow.midX, y: arrow.midY }} transition={{ duration: 0.38, ease: 'easeInOut' }}
              fill={color} fontSize={9} fontFamily="JetBrains Mono, monospace" textAnchor="middle" opacity={0.65}>
              {arrow.label}
            </motion.text>
          </g>
        );
      })}
    </svg>
  );
}
