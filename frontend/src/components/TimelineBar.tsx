import { useRef } from 'react';
import { useExecutionStore } from '../store/executionStore';
import { StepEvent } from '../types/trace';

function eventDotColor(e: StepEvent): string {
  switch (e.type) {
    case 'malloc':  return '#22c55e';
    case 'free':    return '#f97316';
    case 'crash':   return '#ef4444';
    case 'output':  return '#818cf8';
    case 'call':    return '#38bdf8';
    case 'return':  return '#38bdf8';
    case 'end':     return (e as { type: 'end'; leaks: string[]; truncated?: boolean }).truncated ? '#f59e0b' : '#3f3f46';
    case 'start':   return '#3f3f46';
    default:        return '#a1a1aa';
  }
}

export default function TimelineBar() {
  const {
    trace, currentStep, goToStep,
    isPlaying, play, pause, reset,
    stepForward, stepBackward,
    jumpToNextEvent, jumpToPrevEvent, jumpToCrash,
    playbackSpeed, setSpeed,
  } = useExecutionStore();

  const barRef    = useRef<HTMLDivElement>(null);
  const dragging  = useRef(false);
  const total     = trace?.steps.length ?? 1;
  const frame     = trace?.steps[currentStep];
  const isCrash     = frame?.event.type === 'crash';
  const isTruncated = frame?.event.type === 'end' &&
    (frame.event as { type: 'end'; leaks: string[]; truncated?: boolean }).truncated;

  // Does a crash or truncation exist anywhere in the trace?
  const crashExists = trace?.steps.some(
    s => s.event.type === 'crash' ||
      (s.event.type === 'end' && (s.event as { type: 'end'; truncated?: boolean }).truncated),
  ) ?? false;

  const calcStep = (clientX: number) => {
    if (!barRef.current) return;
    const rect  = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    goToStep(Math.round(ratio * (total - 1)));
  };

  const accentColor  = isCrash ? 'bg-red-500' : isTruncated ? 'bg-amber-500' : 'bg-violet-500';
  const playheadColor = isCrash ? 'bg-red-400' : isTruncated ? 'bg-amber-400' : 'bg-violet-400';
  const borderColor  = isCrash
    ? 'border-red-500/30 bg-red-500/5'
    : isTruncated
      ? 'border-amber-500/30 bg-amber-500/5'
      : 'border-zinc-800/60 bg-[#0d0d0f]';

  return (
    <div data-tour="timeline" className={`flex-shrink-0 border-t px-5 py-3 flex items-center gap-4 ${borderColor}`}>

      {/* Transport */}
      <div className="flex items-center gap-1">
        <button
          onClick={reset}
          className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors text-xs"
          title="Reset (0)"
        >⏮</button>
        <button
          onClick={jumpToPrevEvent}
          disabled={currentStep === 0}
          className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 text-[10px]"
          title="Previous event (skip assigns)"
        >«</button>
        <button
          onClick={stepBackward}
          disabled={currentStep === 0}
          className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 text-xs"
          title="Step back (←)"
        >◀</button>
        <button
          onClick={() => isPlaying ? pause() : play()}
          disabled={isCrash}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors text-sm disabled:opacity-30 ${
            isPlaying
              ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
          }`}
          title="Play/Pause (Space)"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          onClick={stepForward}
          disabled={currentStep >= total - 1}
          className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 text-xs"
          title="Step forward (→)"
        >▶</button>
        <button
          onClick={jumpToNextEvent}
          disabled={currentStep >= total - 1}
          className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30 text-[10px]"
          title="Next event (skip assigns)"
        >»</button>

        {/* Jump to crash — only shown when one exists */}
        {crashExists && (
          <button
            onClick={jumpToCrash}
            className={`ml-1 h-6 px-2 rounded text-[10px] font-mono font-semibold transition-colors ${
              isCrash || isTruncated
                ? 'bg-red-500/20 text-red-400 border border-red-500/40 cursor-default'
                : 'bg-zinc-800/80 text-zinc-500 hover:bg-red-500/20 hover:text-red-400 border border-zinc-700/50 hover:border-red-500/40'
            }`}
            title="Jump to crash"
          >
            {isTruncated ? '⚠' : '✕'} {isCrash ? 'crash' : isTruncated ? 'warn' : 'jump to crash'}
          </button>
        )}
      </div>

      {/* Scrub bar — drag enabled */}
      <div
        ref={barRef}
        className="flex-1 h-5 flex items-center cursor-pointer group relative select-none"
        onPointerDown={e => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          calcStep(e.clientX);
        }}
        onPointerMove={e => { if (dragging.current) calcStep(e.clientX); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        {/* Track */}
        <div className="absolute w-full h-0.5 bg-zinc-800 rounded" />
        {/* Progress */}
        <div
          className={`absolute h-0.5 rounded transition-none ${accentColor}`}
          style={{ width: `${(currentStep / Math.max(total - 1, 1)) * 100}%` }}
        />
        {/* Step markers */}
        {(trace?.steps ?? []).map((step, i) => (
          <div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2 top-1/2 hover:scale-150 transition-transform"
            style={{
              left: `${(i / Math.max(total - 1, 1)) * 100}%`,
              backgroundColor: eventDotColor(step.event),
              opacity: i <= currentStep ? 1 : 0.3,
            }}
          />
        ))}
        {/* Playhead */}
        <div
          className={`absolute w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2 top-1/2 border-2 border-[#0d0d0f] z-10 ${playheadColor}`}
          style={{ left: `${(currentStep / Math.max(total - 1, 1)) * 100}%` }}
        />
      </div>

      {/* Step counter */}
      <div className="text-xs font-mono text-zinc-500 w-16 text-right flex-shrink-0">
        <span className={isCrash ? 'text-red-400' : isTruncated ? 'text-amber-400' : 'text-zinc-300'}>
          {currentStep + 1}
        </span>
        <span className="text-zinc-700">/{total}</span>
      </div>

      {/* Speed */}
      <div className="flex items-center gap-1">
        {[1, 2, 4].map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
              playbackSpeed === s
                ? 'bg-violet-500/30 text-violet-300 border border-violet-500/40'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
