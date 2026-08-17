import { useRef, useState } from 'react';
import CodePanel from './CodePanel';
import MemoryCanvas from './MemoryCanvas';

// Left side of the AI modes (Tutor / Interview): the code (read-only, with the
// current line highlighted) stacked over the memory/graph animation, so you can
// see which line the animation is on while the AI talks. Vertically resizable.
export default function AiLeftPane() {
  const [codePct, setCodePct] = useState(42);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastY = useRef(0);

  const onDrag = (dy: number) => {
    const h = containerRef.current?.clientHeight ?? 1;
    setCodePct(p => Math.max(20, Math.min(75, p + (dy / h) * 100)));
  };

  return (
    <div ref={containerRef} className="flex flex-col h-full w-full overflow-hidden">
      <div style={{ height: `${codePct}%` }} className="flex-shrink-0 overflow-hidden">
        <CodePanel readOnly />
      </div>
      <div
        className="h-1.5 flex-shrink-0 cursor-row-resize bg-zinc-800/60 hover:bg-indigo-500/40 transition-colors"
        onPointerDown={e => { dragging.current = true; lastY.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (!dragging.current) return; const dy = e.clientY - lastY.current; lastY.current = e.clientY; onDrag(dy); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        <MemoryCanvas />
      </div>
    </div>
  );
}
