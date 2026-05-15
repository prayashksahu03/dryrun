import { useRef, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useExecutionStore } from '../../store/executionStore';
import StackFrameComponent from './StackFrame';

export default function StackZone() {
  const { currentFrame } = useExecutionStore();
  const frame = currentFrame();
  const stackFrames = frame?.memory.stack ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to newest frame (bottom) when call stack grows
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [stackFrames.length]);

  return (
    <div
      ref={scrollRef}
      className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0"
      style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(99,102,241,0.2) transparent' }}
    >
      <AnimatePresence>
        {stackFrames.map((sf, i) => (
          <StackFrameComponent
            key={sf.function + i}
            frame={sf}
            isActive={i === stackFrames.length - 1}
          />
        ))}
      </AnimatePresence>
      {stackFrames.length === 0 && (
        <div className="text-zinc-800 text-xs font-mono text-center py-2">empty</div>
      )}
    </div>
  );
}
