import { useExecutionStore, PanelKey, PANEL_LABELS } from '../store/executionStore';

const PANEL_ICONS: Record<PanelKey, string> = {
  stack:    '≡',
  heap:     '◉',
  callTree: '⌥',
  eventLog: '≈',
  explain:  '✦',
};

// Detect which panels have content in the current trace
function usePanelRelevance() {
  const { trace, currentStep } = useExecutionStore();
  if (!trace) return { stack: true, heap: false, callTree: false, eventLog: true, explain: false };

  const steps = trace.steps.slice(0, currentStep + 1);
  const frame = trace.steps[currentStep];

  const hasHeap     = frame ? Object.keys(frame.memory.heap).length > 0 : false;
  const hasCallTree = steps.some(s => s.event.type === 'call' &&
    !(s.event as { type: 'call'; function: string }).function.startsWith('<lambda'));
  const hasStack    = frame ? frame.memory.stack.length > 0 : true;

  return { stack: hasStack, heap: hasHeap, callTree: hasCallTree, eventLog: true, explain: !!trace };
}

export default function PanelToggleBar() {
  const { panels, togglePanel } = useExecutionStore();
  const relevance = usePanelRelevance();

  const keys: PanelKey[] = ['stack', 'heap', 'callTree', 'eventLog', 'explain'];

  return (
    <div className="flex items-center justify-center gap-1 h-8 border-b border-zinc-800/60 bg-[#09090b]/80 flex-shrink-0 px-4">
      <span className="text-[9px] font-mono text-zinc-700 uppercase tracking-widest mr-2 select-none">Views</span>
      {keys.map(key => {
        const on = panels[key];
        const relevant = relevance[key];
        return (
          <button
            key={key}
            onClick={() => togglePanel(key)}
            title={on ? `Hide ${PANEL_LABELS[key]}` : `Show ${PANEL_LABELS[key]}`}
            className={[
              'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-all duration-150 select-none',
              on
                ? 'bg-indigo-500/15 border border-indigo-500/35 text-indigo-300 hover:bg-indigo-500/25'
                : 'text-zinc-600 border border-transparent hover:text-zinc-400 hover:border-zinc-700/50',
              !relevant && !on ? 'opacity-40' : '',
            ].join(' ')}
          >
            <span className="text-[9px] opacity-60">{PANEL_ICONS[key]}</span>
            {PANEL_LABELS[key]}
            {on && <span className="w-1 h-1 rounded-full bg-indigo-400/70 flex-shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
