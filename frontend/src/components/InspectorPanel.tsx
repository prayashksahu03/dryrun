import { useRef, useState } from 'react';
import { useExecutionStore, PanelKey } from '../store/executionStore';
import { StepEvent } from '../types/trace';
import CallTreePanel from './CallTreePanel';
import ErrorExplainer from './ErrorExplainer';
import ExplainPanel from './ExplainPanel';

const CRASH_LABELS: Record<string, string> = {
  'null-deref':        'Null Pointer Dereference',
  'use-after-free':    'Use After Free',
  'double-free':       'Double Free',
  'out-of-bounds':     'Array Out Of Bounds',
  'stack-overflow':    'Stack Overflow',
  'division-by-zero':  'Division By Zero',
  'out_of_range':      'Container Underflow',
  'invalid-argument':  'Invalid Argument',
  'segfault':          'Segmentation Fault',
  'assert':            'Assertion Failed',
};

function eventLabel(e: StepEvent): { label: string; color: string; rowBg?: string } {
  switch (e.type) {
    case 'malloc':   return { label: `malloc → ${e.address}`,  color: 'text-green-400' };
    case 'free':     return { label: `free(${e.address})`,     color: 'text-orange-400' };
    case 'assign':   return { label: `${e.target} = ${e.value}`, color: 'text-amber-400' };
    case 'crash':    return {
      label:  `✕ ${CRASH_LABELS[e.kind] ?? e.kind}`,
      color:  'text-red-400',
      rowBg:  'rgba(239,68,68,0.08)',
    };
    case 'warning': {
      const wkind: string = e.kind;
      const WARNING_LABELS: Record<string, string> = {
        'int-overflow':        'Integer Overflow',
        'uninit-var':          'Uninitialized Variable',
        'bitmask-precedence':  'Bitmask Precedence',
        'missing-return':      'Missing Return',
        'modify-during-iter':  'Modify During Iteration',
        'wrong-binary-search': 'Binary Search Logic',
        'queue-duplicate':     'Queue Duplicate (BFS)',
        'pq-order-mismatch':   'PQ Order Mismatch',
        'iterator-invalidation': 'Iterator Invalidation',
      };
      return {
        label: `⚠ ${WARNING_LABELS[wkind] ?? wkind}`,
        color: 'text-amber-400',
        rowBg: 'rgba(251,191,36,0.07)',
      };
    }
    case 'start':    return { label: 'program start',           color: 'text-zinc-500' };
    case 'end':      return { label: 'program end',             color: 'text-zinc-500' };
    case 'call':     return { label: `call ${e.function}()`,    color: 'text-blue-400' };
    case 'return':   return { label: 'return',                  color: 'text-zinc-500' };
    case 'output':   return { label: `› ${(e as {type:'output';text:string}).text.trimEnd()}`, color: 'text-green-400' };
    default:         return { label: '—',                       color: 'text-zinc-600' };
  }
}

// ── Drag handle between sections ──────────────────────────────────────────

function SectionHandle({ onDrag }: { onDrag: (dy: number) => void }) {
  const isDragging = useRef(false);
  const lastY = useRef(0);
  const [active, setActive] = useState(false);

  return (
    <div
      className="flex-shrink-0 relative group"
      style={{ height: 8, cursor: 'row-resize', zIndex: 20 }}
      onPointerDown={e => {
        isDragging.current = true;
        setActive(true);
        lastY.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (!isDragging.current) return;
        const dy = e.clientY - lastY.current;
        lastY.current = e.clientY;
        onDrag(dy);
      }}
      onPointerUp={() => { isDragging.current = false; setActive(false); }}
      onPointerCancel={() => { isDragging.current = false; setActive(false); }}
    >
      {/* Visual line */}
      <div
        className="absolute inset-x-0 transition-all duration-100"
        style={{
          top: '50%',
          height: active ? 2 : 1,
          marginTop: active ? -1 : 0,
          background: active
            ? 'rgba(99,102,241,0.6)'
            : 'rgba(63,63,70,0.6)',
        }}
      />
      {/* Grip dots */}
      <div className={`absolute inset-0 flex items-center justify-center gap-1 transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}>
        {[0, 1, 2].map(i => (
          <div key={i} className="w-3 h-px rounded-full bg-indigo-400/70" />
        ))}
      </div>
    </div>
  );
}

// ── Inspector panel ───────────────────────────────────────────────────────

const MIN_H = 60;

export default function InspectorPanel() {
  const { trace, currentStep, currentFrame, panels } = useExecutionStore();
  const showCallTree = panels['callTree' as PanelKey];
  const showHeap     = panels['heap'     as PanelKey];
  const showEventLog = panels['eventLog' as PanelKey];
  const showExplain  = panels['explain'  as PanelKey];

  const frame = currentFrame();
  const heap  = frame?.memory.heap ?? {};

  const leakedAddrs = Object.entries(heap)
    .filter(([, b]) => b.state === 'allocated')
    .map(([addr]) => addr);

  // Per-section heights (px) — only Call Tree, Variables, Heap are resizable;
  // Event Log always takes the remaining flex-1 space.
  const [heights, setHeights] = useState({ callTree: 200, heap: 110 });
  const setH = (key: keyof typeof heights, dy: number) =>
    setHeights(h => ({ ...h, [key]: Math.max(MIN_H, h[key] + dy) }));

  // Determine which sections are visible (to decide where to place handles)
  const sectionsBelow = {
    callTree: showHeap || showEventLog,
    heap:     showEventLog,
  };

  return (
    <div data-tour="inspector" className="flex flex-col border-l border-zinc-800/60 bg-[#111113] overflow-hidden h-full w-full">

      {/* Call Tree */}
      {showCallTree && trace && (
        <div
          className="overflow-hidden flex-shrink-0 flex flex-col"
          style={{ height: heights.callTree }}
        >
          <CallTreePanel steps={trace.steps} currentStep={currentStep} />
        </div>
      )}
      {showCallTree && !!trace && sectionsBelow.callTree && (
        <SectionHandle onDrag={dy => setH('callTree', dy)} />
      )}

      {/* Heap summary */}
      {showHeap && (
        <div
          className="overflow-hidden flex-shrink-0 flex flex-col"
          style={{ height: heights.heap }}
        >
          <div className="px-3 py-2 text-[10px] text-zinc-600 uppercase tracking-widest font-mono flex-shrink-0">Heap</div>
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
            {Object.entries(heap).map(([addr, block]) => (
              <div key={addr} className="flex items-center justify-between py-0.5">
                <span className="text-xs font-mono text-zinc-500">{addr}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  block.state === 'freed'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-green-500/10 text-green-400 border border-green-500/20'
                }`}>
                  {block.state === 'freed' ? 'freed' : `${block.typeName}`}
                </span>
              </div>
            ))}
            {Object.keys(heap).length === 0 && (
              <div className="text-zinc-700 text-xs font-mono">empty</div>
            )}
          </div>
        </div>
      )}
      {showHeap && sectionsBelow.heap && (
        <SectionHandle onDrag={dy => setH('heap', dy)} />
      )}

      {/* Event log — always flex-1, takes remaining space */}
      {showEventLog ? (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="px-3 py-2 text-[10px] text-zinc-600 uppercase tracking-widest font-mono flex-shrink-0">Event Log</div>
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
            {(trace?.steps ?? []).slice(0, currentStep + 1).map((step, i) => {
              const { label, color, rowBg } = eventLabel(step.event);
              const isLatest = i === currentStep;
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2 py-0.5 rounded ${isLatest ? 'opacity-100' : 'opacity-40'}`}
                  style={isLatest && rowBg ? { background: rowBg, marginLeft: -4, paddingLeft: 4, paddingRight: 4 } : undefined}
                >
                  <span className="text-zinc-700 text-[10px] font-mono w-4 flex-shrink-0">{i + 1}</span>
                  <span className={`text-[10px] font-mono ${color}${step.event.type === 'output' ? ' whitespace-pre-wrap' : ''}`}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Explain tutor (grounded LLM narration) */}
      {showExplain && trace && <ExplainPanel />}

      {/* Error / warning explainer */}
      <ErrorExplainer />

      {/* Leak warning */}
      {frame?.event.type === 'end' && leakedAddrs.length > 0 && (
        <div className="px-3 py-2 border-t border-amber-500/30 bg-amber-500/5 text-amber-400 text-[10px] font-mono flex-shrink-0">
          ⚠ {leakedAddrs.length} block{leakedAddrs.length > 1 ? 's' : ''} leaked — memory not freed before program exit
        </div>
      )}
    </div>
  );
}
