import { useRef, useCallback, useState, useEffect, useLayoutEffect, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useExecutionStore } from '../store/executionStore';
import { RefRegistryContext } from '../contexts/refRegistry';
import StackZone from './stack/StackZone';
import HeapBlockComponent from './heap/HeapBlock';
import AnimationPanel, { heapClaimedByAnimation } from './AnimationPanel';
import ArrowLayer from './arrows/ArrowLayer';
import HintCard from './HintCard';
import { getVisualIdentity } from '../utils/visualIdentity';
import { resolveHints } from '../data/guided';

const MIN_PCT = 24;
const MAX_PCT = 60;
const DEFAULT_PCT = 36;

// ── Inline heap strip ───────────────────────────────────────────────────────
// Heap allocations live INSIDE the memory column, under the stack — the heap is
// rare enough that it doesn't earn a dedicated zone. A dashed separator + label
// keeps it distinguishable. Blocks consumed by a structure view (tree/trie) are
// drawn in the Animation panel instead, so they're skipped here.
function HeapInline() {
  const { currentFrame } = useExecutionStore();
  const frame = currentFrame();
  if (!frame) return null;

  const heap = frame.memory.heap;
  const entries = Object.entries(heap);
  if (entries.length === 0 || heapClaimedByAnimation(heap)) return null;

  const isCrash   = frame.event.type === 'crash';
  const crashAddr = isCrash
    ? (frame.event as { type: 'crash'; address?: string }).address
    : undefined;

  return (
    <div className="flex-shrink-0 pt-2 pb-1" data-tour="heap-zone">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono text-zinc-700 tracking-[0.18em] uppercase">heap</span>
        <div className="flex-1 border-t border-dashed border-zinc-800/70" />
      </div>
      <div className="flex flex-wrap gap-3 content-start overflow-y-auto max-h-[38vh]">
        <AnimatePresence>
          {entries.map(([addr, block]) => (
            <HeapBlockComponent
              key={getVisualIdentity(block, addr)}
              address={addr}
              block={block}
              isCrashTarget={addr === crashAddr}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── MemoryCanvas ────────────────────────────────────────────────────────────
// The whole right-of-code area: memory column (stack frames + inline heap) in
// the middle of the app, animation panel (grids/graphs/trees) on the right.
// One registry + one arrow overlay span BOTH columns, so pointer arrows keep
// working from stack variables to heap blocks and tree/trie nodes wherever
// they render.
export default function MemoryCanvas() {
  const canvasRef    = useRef<HTMLDivElement>(null);
  const registryMap  = useRef<Map<string, HTMLElement>>(new Map());
  const { currentStep, trace, activeGuidedProgram } = useExecutionStore();

  const resolvedHints = useMemo(
    () => (trace && activeGuidedProgram)
      ? resolveHints(trace.steps, activeGuidedProgram.hints)
      : new Map<number, string>(),
    [trace, activeGuidedProgram],
  );
  const currentHint = resolvedHints.get(currentStep);

  const [tick, setTick]       = useState(0);
  const [memPct, setMemPct]   = useState(DEFAULT_PCT);
  const [dragging, setDragging] = useState(false);
  const isDragging            = useRef(false);
  const lastCanvasWidth       = useRef(0);

  // Bump tick synchronously whenever the canvas width changes (external panel
  // resize) so ArrowLayer recomputes paths against new node positions.
  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const w = canvasRef.current.offsetWidth;
    if (w !== lastCanvasWidth.current) {
      lastCanvasWidth.current = w;
      setTick(t => t + 1);
    }
  });

  const register = useCallback((key: string, el: HTMLElement | null) => {
    if (el) registryMap.current.set(key, el);
    else    registryMap.current.delete(key);
  }, []);

  const getEl = useCallback((key: string) => registryMap.current.get(key) ?? null, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setTick(t => t + 1));
    return () => cancelAnimationFrame(id);
  }, [currentStep]);

  // ── Column divider drag (memory | animation) ─────────────────────────────
  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDragging.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const pct  = ((e.clientX - rect.left) / rect.width) * 100;
    setMemPct(Math.min(Math.max(pct, MIN_PCT), MAX_PCT));
    setTick(t => t + 1);
  };

  const onDividerPointerUp = () => {
    isDragging.current = false;
    setDragging(false);
  };

  return (
    <RefRegistryContext.Provider value={{ register, getEl, canvasRef }}>
      <div
        ref={canvasRef}
        className="flex-1 flex relative overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, #0d1520 0%, #0a0a0c 45%, #091409 100%)',
          userSelect: dragging ? 'none' : undefined,
          cursor:     dragging ? 'col-resize' : undefined,
        }}
      >
        {/* Dot grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* ── Memory column: stack frames (recursion stacks naturally) + inline heap ── */}
        <div
          data-tour="stack-zone"
          className="flex flex-col px-5 pt-8 pb-3 relative z-10 min-h-0 flex-shrink-0"
          style={{ width: `${memPct}%` }}
        >
          <div className="absolute top-3 left-5 text-[9px] font-mono text-zinc-700 tracking-[0.18em] uppercase pointer-events-none">
            Memory
          </div>
          <StackZone />
          <HeapInline />
        </div>

        {/* ── Draggable column divider ── */}
        <div
          className="relative z-20 flex-shrink-0 flex items-center justify-center"
          style={{ width: 14, cursor: 'col-resize', marginLeft: -7, marginRight: -7 }}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onPointerCancel={onDividerPointerUp}
        >
          <div
            className="absolute inset-y-0"
            style={{
              left: '50%',
              borderLeft: `1px dashed ${dragging ? 'rgba(99,102,241,0.45)' : 'rgba(63,63,70,0.5)'}`,
              transition: 'border-color 0.15s',
            }}
          />
        </div>

        {/* ── Animation column: grids / graphs / trees / tries / segtrees ── */}
        <div className="flex-1 min-w-0 flex flex-col relative">
          <div className="absolute top-3 left-4 text-[9px] font-mono text-zinc-700 tracking-[0.18em] uppercase z-10 pointer-events-none">
            Animation
          </div>
          <AnimationPanel />
        </div>

        {/* Hint card — shown when a guided program hint exists for this step */}
        <HintCard hint={currentHint} />

        {/* Arrow SVG overlay — spans both columns */}
        <ArrowLayer tick={tick} />
      </div>
    </RefRegistryContext.Provider>
  );
}
