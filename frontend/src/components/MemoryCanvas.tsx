import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { useExecutionStore, PanelKey } from '../store/executionStore';
import { RefRegistryContext } from '../contexts/refRegistry';
import StackZone from './stack/StackZone';
import HeapZone from './heap/HeapZone';
import ArrowLayer from './arrows/ArrowLayer';
import HintCard from './HintCard';
import { resolveHints } from '../data/guided';

const MIN_PCT = 18;
const MAX_PCT = 78;
const DEFAULT_PCT = 42;

export default function MemoryCanvas() {
  const canvasRef    = useRef<HTMLDivElement>(null);
  const registryMap  = useRef<Map<string, HTMLElement>>(new Map());
  const { currentStep, panels, trace, activeGuidedProgram } = useExecutionStore();

  const resolvedHints = useMemo(
    () => (trace && activeGuidedProgram)
      ? resolveHints(trace.steps, activeGuidedProgram.hints)
      : new Map<number, string>(),
    [trace, activeGuidedProgram],
  );
  const currentHint = resolvedHints.get(currentStep);
  const showStack = panels['stack' as PanelKey];
  const showHeap  = panels['heap'  as PanelKey];
  const [tick, setTick]         = useState(0);
  const [stackPct, setStackPct] = useState(DEFAULT_PCT);
  const [dragging, setDragging] = useState(false);
  const isDragging              = useRef(false);

  const register = useCallback((key: string, el: HTMLElement | null) => {
    if (el) registryMap.current.set(key, el);
    else    registryMap.current.delete(key);
  }, []);

  const getEl = useCallback((key: string) => registryMap.current.get(key) ?? null, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setTick(t => t + 1));
    return () => cancelAnimationFrame(id);
  }, [currentStep]);

  // ── Divider drag ───────────────────────────────────────────────────
  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDragging.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const pct  = ((e.clientY - rect.top) / rect.height) * 100;
    setStackPct(Math.min(Math.max(pct, MIN_PCT), MAX_PCT));
  };

  const onDividerPointerUp = () => {
    isDragging.current = false;
    setDragging(false);
  };

  return (
    <RefRegistryContext.Provider value={{ register, getEl, canvasRef }}>
      <div
        ref={canvasRef}
        className="flex-1 flex flex-col relative overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, #0d1520 0%, #0a0a0c 45%, #091409 100%)',
          userSelect: dragging ? 'none' : undefined,
          cursor:     dragging ? 'row-resize' : undefined,
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

        {/* Zone label — Stack */}
        {showStack && (
          <div className="absolute top-3 left-5 text-[9px] font-mono text-zinc-700 tracking-[0.18em] uppercase z-10 pointer-events-none">
            Stack
          </div>
        )}

        {/* Zone label — Heap */}
        {showHeap && (
          <div
            className="absolute left-5 text-[9px] font-mono text-zinc-700 tracking-[0.18em] uppercase z-10 pointer-events-none"
            style={{ top: showStack ? `calc(${stackPct}% + 22px)` : '12px' }}
          >
            Heap
          </div>
        )}

        {/* Stack zone */}
        {showStack && (
          <div
            data-tour="stack-zone"
            className="flex flex-col px-6 pt-8 pb-3 relative z-10 min-h-0 flex-shrink-0"
            style={{ height: showHeap ? `${stackPct}%` : '100%' }}
          >
            <StackZone />
          </div>
        )}

        {/* ── Draggable divider — only when both zones visible ── */}
        {showStack && showHeap && (
          <div
            className="relative z-20 flex-shrink-0 flex items-center justify-center mx-6"
            style={{ height: 20, cursor: 'row-resize', marginTop: -10, marginBottom: -10 }}
            onPointerDown={onDividerPointerDown}
            onPointerMove={onDividerPointerMove}
            onPointerUp={onDividerPointerUp}
            onPointerCancel={onDividerPointerUp}
          >
            <div
              className="absolute inset-x-0"
              style={{
                top: '50%',
                borderTop: `1px dashed ${dragging ? 'rgba(99,102,241,0.45)' : 'rgba(63,63,70,0.5)'}`,
                transition: 'border-color 0.15s',
              }}
            />
            <div
              className="relative flex items-center gap-0.5 px-2 py-0.5 rounded-sm border transition-all duration-150"
              style={{
                background: dragging ? 'rgba(99,102,241,0.12)' : 'rgba(10,10,12,0.95)',
                borderColor: dragging ? 'rgba(99,102,241,0.5)' : 'rgba(63,63,70,0.7)',
              }}
            >
              <span
                className="text-[9px] font-mono tracking-wide select-none transition-colors duration-150"
                style={{ color: dragging ? 'rgba(129,140,248,0.9)' : 'rgba(82,82,91,0.9)' }}
              >
                memory boundary
              </span>
              <svg width="10" height="8" viewBox="0 0 10 8" className="ml-0.5 flex-shrink-0">
                {[0, 3].map(cx =>
                  [1, 4, 7].map(cy => (
                    <circle
                      key={`${cx}-${cy}`}
                      cx={cx + 2} cy={cy}
                      r={0.9}
                      fill={dragging ? 'rgba(129,140,248,0.7)' : 'rgba(82,82,91,0.5)'}
                    />
                  )),
                )}
              </svg>
            </div>
          </div>
        )}

        {/* Heap zone */}
        {showHeap && (
          <div data-tour="heap-zone" className="flex-1 overflow-hidden px-6 pt-6 pb-4 relative z-10 flex flex-col min-h-0">
            <HeapZone />
          </div>
        )}

        {/* Empty state when both zones are hidden */}
        {!showStack && !showHeap && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-zinc-700 text-xs font-mono">Enable Stack or Heap from the view bar above</span>
          </div>
        )}

        {/* Hint card — shown when a guided program hint exists for this step */}
        <HintCard hint={currentHint} />

        {/* Arrow SVG overlay */}
        <ArrowLayer tick={tick} />
      </div>
    </RefRegistryContext.Provider>
  );
}
