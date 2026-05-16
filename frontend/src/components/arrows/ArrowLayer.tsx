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
  return Math.max(65, Math.abs(to.x - from.x) * 0.6 + Math.abs(to.y - from.y) * 0.4);
}

function bezier(
  from: { x: number; y: number },
  to:   { x: number; y: number },
  arcAbove?: boolean,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (arcAbove) {
    // Arc up and over — for heap back-references and self-pointers
    const lift  = liftAmount(from, to);
    const ctrlY = Math.min(from.y, to.y) - lift;
    return `M ${from.x} ${from.y} C ${from.x} ${ctrlY}, ${to.x} ${ctrlY}, ${to.x} ${to.y}`;
  }

  // Stack→heap arrows travel mostly vertically. Use vertical control points so
  // the curve goes straight down then curves into the target — never looping up.
  if (Math.abs(dy) > Math.abs(dx) * 0.6) {
    const cy = Math.max(Math.abs(dy) * 0.45, 24);
    return `M ${from.x} ${from.y} C ${from.x} ${from.y + cy}, ${to.x} ${to.y - cy}, ${to.x} ${to.y}`;
  }

  // Heap→heap forward arrows (linked list, same row): use horizontal control points.
  return `M ${from.x} ${from.y} C ${from.x + dx * 0.55} ${from.y}, ${from.x + dx * 0.45} ${to.y}, ${to.x} ${to.y}`;
}

// Compute the visual midpoint of the arc-above bezier for label placement.
// At t=0.5: B = 0.125*P0 + 0.375*P1 + 0.375*P2 + 0.125*P3
function arcMid(from: { x: number; y: number }, to: { x: number; y: number }) {
  const lift  = liftAmount(from, to);
  const ctrlY = Math.min(from.y, to.y) - lift;
  return {
    x: (from.x + to.x) / 2,
    y: 0.125 * (from.y + to.y) + 0.75 * ctrlY + 14, // +14: label just below arc peak
  };
}

function midpoint(
  from: { x: number; y: number },
  to:   { x: number; y: number },
) {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function rectEdge(rect: DOMRect, side: 'left' | 'right' | 'top', canvas: DOMRect) {
  if (side === 'top') {
    return {
      x: rect.left + rect.width / 2 - canvas.left,
      y: rect.top - canvas.top,
    };
  }
  return {
    x: (side === 'right' ? rect.right : rect.left) - canvas.left,
    y: rect.top + rect.height / 2 - canvas.top,
  };
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
      // Skip when the source variable is scrolled out of the canvas viewport
      // (e.g. older stack frames scrolled above the stack zone boundary)
      if (!inCanvasBounds(srcRect)) return;

      const from = rectEdge(srcRect, 'right', canvasRect);

      if (!targetAddr) {
        const to = { x: from.x + 18, y: from.y + 20 };
        const mid = midpoint(from, to);
        computed.push({ id, label, path: bezier(from, to), midX: mid.x, midY: mid.y - 6, state: 'null' });
        return;
      }

      const tgtEl = getEl(`heap:${targetAddr}`);
      if (!tgtEl) return;

      const tgtRect = tgtEl.getBoundingClientRect();
      if (!inCanvasBounds(tgtRect)) return;

      const isFreed = heap[targetAddr]?.state === 'freed';

      // Self-pointer: source field lives inside the target block
      const isSelf = isHeapArrow && srcKey.startsWith(`heap:${targetAddr}:`);
      // Back-reference: target block is to the left of the source (circular / reverse link)
      const isBackRef = isHeapArrow && !isSelf && tgtRect.right < srcRect.left;
      const arcAbove  = isSelf || isBackRef;

      let to: { x: number; y: number };
      let mid: { x: number; y: number };

      if (arcAbove) {
        // Curve up and over — land on top of target so the arrow arrives cleanly from above
        to  = rectEdge(tgtRect, 'top', canvasRect);
        mid = arcMid(from, to);
      } else {
        // If source is significantly above target, land on the top of the block
        // so the vertical bezier arrives naturally. Otherwise use left edge (horizontal).
        const landOnTop = (tgtRect.top - srcRect.bottom) > 40;
        to  = rectEdge(tgtRect, landOnTop ? 'top' : 'left', canvasRect);
        const rawMid = midpoint(from, to);
        mid = { x: rawMid.x, y: rawMid.y - 8 };
      }

      computed.push({
        id, label,
        path: bezier(from, to, arcAbove),
        midX: mid.x, midY: mid.y,
        state: isFreed ? 'freed' : 'valid',
      });
    };

    // Only draw pointer arrows from the innermost (topmost) active frame.
    // Drawing from every frame simultaneously causes overlapping sweeping arrows
    // across the memory boundary during deep recursion.
    const stack = frame.memory.stack;
    const activeFrames = stack.length <= 1
      ? stack                                    // single frame: just show it
      : [stack[0], stack[stack.length - 1]];    // outermost (main) + innermost (current fn)

    activeFrames.forEach(sf => {
      Object.entries(sf.variables).forEach(([varName, val]) => {
        if (val.kind === 'pointer') {
          addArrow(
            `s:${sf.function}:${varName}`,
            varName,
            `stack:${sf.function}:${varName}`,
            val.address,
            false,
          );
        }
      });
    });

    // Heap pointer fields (e.g. a->next pointing to b)
    Object.entries(heap).forEach(([addr, block]) => {
      if (block.state === 'freed') return;
      Object.entries(block.fields).forEach(([field, val]) => {
        if (val.kind === 'pointer' && val.address !== null) {
          addArrow(
            `h:${addr}:${field}`,
            `→${field}`,
            `heap:${addr}:${field}`,
            val.address,
            true,
          );
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
          <marker
            key={s}
            id={`ah-${s}`}
            markerWidth="7" markerHeight="7"
            refX="5" refY="3.5"
            orient="auto"
          >
            <path d="M0,0.5 L6,3.5 L0,6.5 Z" fill={colorOf(s)} />
          </marker>
        ))}
      </defs>

      {arrows.map(arrow => {
        const color   = colorOf(arrow.state);
        const isDash  = arrow.state === 'freed';

        return (
          <g key={arrow.id}>
            {/* Soft glow */}
            <motion.path
              d={arrow.path}
              animate={{ d: arrow.path }}
              transition={{ duration: 0.38, ease: 'easeInOut' }}
              stroke={color}
              strokeWidth={5}
              fill="none"
              opacity={0.10}
              strokeLinecap="round"
            />
            {/* Arrow line */}
            <motion.path
              d={arrow.path}
              animate={{ d: arrow.path }}
              transition={{ duration: 0.38, ease: 'easeInOut' }}
              stroke={color}
              strokeWidth={1.5}
              fill="none"
              strokeDasharray={isDash ? '5 3' : undefined}
              markerEnd={`url(#ah-${arrow.state})`}
              strokeLinecap="round"
              opacity={0.9}
            />
            {/* Label */}
            <motion.text
              animate={{ x: arrow.midX, y: arrow.midY }}
              transition={{ duration: 0.38, ease: 'easeInOut' }}
              fill={color}
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
              textAnchor="middle"
              opacity={0.65}
            >
              {arrow.label}
            </motion.text>
          </g>
        );
      })}
    </svg>
  );
}
