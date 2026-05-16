import { useLayoutEffect, useEffect, useState } from 'react';
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

// All paths use M-L-L-L (4 points, 3 segments) for consistent Framer Motion animation.

// L-shape: horizontal first (to target x), then vertical down.
// Each stack variable uses its own y-level for the horizontal arm → no two arms share a segment.
function lPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midY = from.y + (to.y - from.y) * 0.5;
  return `M ${from.x} ${from.y} L ${to.x} ${from.y} L ${to.x} ${midY} L ${to.x} ${to.y}`;
}

// Straight diagonal, split into 3 equal segments so it matches the 4-point format.
function straightPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const x1 = from.x + (to.x - from.x) / 3, y1 = from.y + (to.y - from.y) / 3;
  const x2 = from.x + (to.x - from.x) * 2 / 3, y2 = from.y + (to.y - from.y) * 2 / 3;
  return `M ${from.x} ${from.y} L ${x1} ${y1} L ${x2} ${y2} L ${to.x} ${to.y}`;
}

// Orthogonal U: down → horizontal at yFloor → up. Used for back-references.
function orthoPath(from: { x: number; y: number }, to: { x: number; y: number }, yFloor: number): string {
  return `M ${from.x} ${from.y} L ${from.x} ${yFloor} L ${to.x} ${yFloor} L ${to.x} ${to.y}`;
}

function rectEdge(rect: DOMRect, side: 'left' | 'right' | 'top' | 'bottom', canvas: DOMRect) {
  switch (side) {
    case 'top':    return { x: rect.left + rect.width / 2 - canvas.left, y: rect.top    - canvas.top };
    case 'bottom': return { x: rect.left + rect.width / 2 - canvas.left, y: rect.bottom - canvas.top };
    default:       return { x: (side === 'right' ? rect.right : rect.left) - canvas.left, y: rect.top + rect.height / 2 - canvas.top };
  }
}

// Pending back-ref/self arrow, collected before paths are computed so yFloor can be staggered.
interface BackRefPending {
  id: string;
  label: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  blockBottom: number; // bottom of the source block (canvas-relative)
  tgtBottom: number;   // bottom of the target block (canvas-relative)
  state: Arrow['state'];
  span: number;        // euclidean-ish distance used to sort lanes
}

export default function ArrowLayer({ tick }: { tick: number }) {
  const { getEl, canvasRef } = useRefRegistry();
  const { currentFrame }      = useExecutionStore();
  const [arrows, setArrows]   = useState<Arrow[]>([]);
  const [resizeTick, setResizeTick] = useState(0);

  // Recompute arrows whenever the canvas is resized (panel drag, window resize).
  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(() => setResizeTick(t => t + 1));
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [canvasRef]);

  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    if (canvasRect.width === 0) return;

    const frame = currentFrame();
    if (!frame) { setArrows([]); return; }

    const heap = frame.memory.heap;
    const computed: Arrow[]         = [];
    const backRefs: BackRefPending[] = [];

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
        const to = { x: from.x + 16, y: from.y + 10 };
        computed.push({ id, label, path: straightPath(from, to), midX: (from.x+to.x)/2, midY: (from.y+to.y)/2-6, state: 'null' });
        return;
      }

      const tgtEl = getEl(`heap:${targetAddr}`);
      if (!tgtEl) return;
      const tgtRect = tgtEl.getBoundingClientRect();
      if (!inCanvasBounds(tgtRect)) return;

      const isFreed   = heap[targetAddr]?.state === 'freed';
      const isSelf    = isHeapArrow && srcKey.startsWith(`heap:${targetAddr}:`);
      const isBackRef = isHeapArrow && !isSelf && tgtRect.right < srcRect.left;

      if (isSelf || isBackRef) {
        // ── Corridor 3: collect for staggered yFloor assignment ────────────
        const srcBlockEl = getEl(srcKey.replace(/:([^:]+)$/, ''));
        const blockBottom = (srcBlockEl
          ? srcBlockEl.getBoundingClientRect().bottom
          : srcRect.bottom) - canvasRect.top;
        const tgtBottom = tgtRect.bottom - canvasRect.top;
        const to = rectEdge(tgtRect, 'bottom', canvasRect);
        const span = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        backRefs.push({ id, label, from, to, blockBottom, tgtBottom, state: isFreed ? 'freed' : 'valid', span });

      } else if (!isHeapArrow) {
        // ── Corridor 1: stack→heap ─────────────────────────────────────────
        // Drop vertically at (tgtRect.left - 8), left of the block column, so
        // the path never passes through blocks that sit above the target.
        // Then enter the target from its left edge at mid-height.
        const to   = rectEdge(tgtRect, 'left', canvasRect);
        const xDrop = (tgtRect.left - canvasRect.left) - 8;
        const path  = `M ${from.x} ${from.y} L ${xDrop} ${from.y} L ${xDrop} ${to.y} L ${to.x} ${to.y}`;
        computed.push({ id, label, path, midX: (from.x + xDrop) / 2, midY: from.y - 8, state: isFreed ? 'freed' : 'valid' });

      } else {
        // ── Corridor 2: heap→heap forward link ────────────────────────────
        const landOnTop = (tgtRect.top - srcRect.bottom) > 40;
        const to = rectEdge(tgtRect, landOnTop ? 'top' : 'left', canvasRect);
        const path = straightPath(from, to);
        computed.push({ id, label, path, midX: (from.x + to.x) / 2, midY: (from.y + to.y) / 2 - 8, state: isFreed ? 'freed' : 'valid' });
      }
    };

    const stack = frame.memory.stack;
    const activeFrames = stack.length <= 1 ? stack : [stack[0], stack[stack.length - 1]];

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

    // ── Corridor 3: assign staggered yFloor lanes ──────────────────────────
    // Sort ascending by span so shorter arcs get shallower lanes and longer
    // arcs nest below them — a clean "railroad" with no overlaps.
    const Y_LANE_STEP = 18;
    backRefs.sort((a, b) => a.span - b.span);
    const globalBlockFloor = backRefs.reduce((m, r) => Math.max(m, r.blockBottom, r.tgtBottom), 0);
    backRefs.forEach((r, i) => {
      const yFloor = globalBlockFloor + 24 + i * Y_LANE_STEP;
      const path   = orthoPath(r.from, r.to, yFloor);
      computed.push({ id: r.id, label: r.label, path, midX: (r.from.x + r.to.x) / 2, midY: yFloor - 8, state: r.state });
    });

    setArrows(computed);
  }, [tick, resizeTick, currentFrame, getEl, canvasRef]);

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
            <motion.path d={arrow.path} animate={{ d: arrow.path }} transition={{ duration: 0.25, ease: 'easeInOut' }}
              stroke={color} strokeWidth={4} fill="none" opacity={0.08} strokeLinecap="square" />
            <motion.path d={arrow.path} animate={{ d: arrow.path }} transition={{ duration: 0.25, ease: 'easeInOut' }}
              stroke={color} strokeWidth={1.5} fill="none"
              strokeDasharray={isDash ? '5 3' : undefined}
              markerEnd={`url(#ah-${arrow.state})`}
              strokeLinecap="square" opacity={0.85} />
            <motion.text animate={{ x: arrow.midX, y: arrow.midY }} transition={{ duration: 0.25, ease: 'easeInOut' }}
              fill={color} fontSize={9} fontFamily="JetBrains Mono, monospace" textAnchor="middle" opacity={0.65}>
              {arrow.label}
            </motion.text>
          </g>
        );
      })}
    </svg>
  );
}
