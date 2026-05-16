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

// All paths are normalized to M P0 L P1 L P2 L P3 so Framer Motion
// can interpolate smoothly between different routing shapes.

function straightPath(
  from: { x: number; y: number },
  to:   { x: number; y: number },
): string {
  const x1 = from.x + (to.x - from.x) / 3;
  const y1 = from.y + (to.y - from.y) / 3;
  const x2 = from.x + (to.x - from.x) * 2 / 3;
  const y2 = from.y + (to.y - from.y) * 2 / 3;
  return `M ${from.x} ${from.y} L ${x1} ${y1} L ${x2} ${y2} L ${to.x} ${to.y}`;
}

// Orthogonal U-route that drops below yFloor:
//   P0 → straight down to (P0.x, yFloor) → left/right to (P3.x, yFloor) → up to P3
function orthoPath(
  from: { x: number; y: number },
  to:   { x: number; y: number },
  yFloor: number,
): string {
  return `M ${from.x} ${from.y} L ${from.x} ${yFloor} L ${to.x} ${yFloor} L ${to.x} ${to.y}`;
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
        const to = { x: from.x + 16, y: from.y + 10 };
        computed.push({
          id, label,
          path: straightPath(from, to),
          midX: (from.x + to.x) / 2, midY: (from.y + to.y) / 2 - 6,
          state: 'null',
        });
        return;
      }

      const tgtEl = getEl(`heap:${targetAddr}`);
      if (!tgtEl) return;
      const tgtRect = tgtEl.getBoundingClientRect();
      if (!inCanvasBounds(tgtRect)) return;

      const isFreed   = heap[targetAddr]?.state === 'freed';
      const isSelf    = isHeapArrow && srcKey.startsWith(`heap:${targetAddr}:`);
      const isBackRef = isHeapArrow && !isSelf && tgtRect.right < srcRect.left;

      let path: string;
      let midX: number;
      let midY: number;

      if (isSelf || isBackRef) {
        // ── Corridor 3: orthogonal U below the blocks ─────────────────────
        // Find the bottom of the source block so the U clears it.
        const srcBlockKey = isHeapArrow ? srcKey.replace(/:([^:]+)$/, '') : null;
        const srcBlockEl  = srcBlockKey ? getEl(srcBlockKey) : null;
        const srcBlockBottom = srcBlockEl
          ? srcBlockEl.getBoundingClientRect().bottom
          : srcRect.bottom;
        const yFloor = Math.max(srcBlockBottom, tgtRect.bottom) - canvasRect.top + 28;

        const to = rectEdge(tgtRect, 'bottom', canvasRect);
        path  = orthoPath(from, to, yFloor);
        midX  = (from.x + to.x) / 2;
        midY  = yFloor - 8; // label inside the U, just above the floor

      } else if (!isHeapArrow) {
        // ── Corridor 1: stack→heap straight diagonal, land on block top ───
        const to = rectEdge(tgtRect, 'top', canvasRect);
        path = straightPath(from, to);
        midX = (from.x + to.x) / 2;
        midY = (from.y + to.y) / 2 - 8;

      } else {
        // ── Corridor 2: heap→heap forward link, straight to left edge ─────
        const landOnTop = (tgtRect.top - srcRect.bottom) > 40;
        const to = rectEdge(tgtRect, landOnTop ? 'top' : 'left', canvasRect);
        path = straightPath(from, to);
        midX = (from.x + to.x) / 2;
        midY = (from.y + to.y) / 2 - 8;
      }

      computed.push({ id, label, path, midX, midY, state: isFreed ? 'freed' : 'valid' });
    };

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
            <motion.path d={arrow.path} animate={{ d: arrow.path }} transition={{ duration: 0.25, ease: 'easeInOut' }}
              stroke={color} strokeWidth={5} fill="none" opacity={0.08} strokeLinecap="round" />
            <motion.path d={arrow.path} animate={{ d: arrow.path }} transition={{ duration: 0.25, ease: 'easeInOut' }}
              stroke={color} strokeWidth={1.5} fill="none"
              strokeDasharray={isDash ? '5 3' : undefined}
              markerEnd={`url(#ah-${arrow.state})`}
              strokeLinecap="square" opacity={0.9} />
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
