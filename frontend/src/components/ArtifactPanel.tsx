import { useState } from 'react';
import MemoryCanvas from './MemoryCanvas';
import CodePanel from './CodePanel';

// The Tutor's live "artifact": the program's execution, shown next to the
// conversation. A tab toggles between the Animation (memory/graph) and the Code
// (read-only, line-highlighted) so each gets full height — no stacking crunch.
// Both are driven by the current step, so clicking a beat in the chat updates
// whichever tab is showing.
export default function ArtifactPanel() {
  const [tab, setTab] = useState<'animation' | 'code'>('animation');

  return (
    <div className="flex flex-col h-full w-full border-l border-zinc-800/60 bg-[#09090b] overflow-hidden">
      <div className="flex items-center gap-1 h-9 px-3 border-b border-zinc-800/60 flex-shrink-0">
        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mr-2">Artifact</span>
        {(['animation', 'code'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'h-6 px-2.5 rounded text-[11px] font-mono capitalize transition-colors',
              tab === t
                ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30'
                : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'animation' ? <MemoryCanvas /> : <CodePanel readOnly />}
      </div>
    </div>
  );
}
