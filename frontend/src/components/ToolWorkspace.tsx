import { useEffect, useRef, useState } from 'react';
import { useExecutionStore } from '../store/executionStore';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import CodePanel from './CodePanel';
import MemoryCanvas from './MemoryCanvas';
import InspectorPanel from './InspectorPanel';
import TimelineBar from './TimelineBar';
import PanelToggleBar from './PanelToggleBar';
import AmbiguityPanel from './AmbiguityPanel';
import ArtifactPanel from './ArtifactPanel';
import TutorConversation from './TutorConversation';
import InterviewConversation from './InterviewConversation';

// ── Column drag handle ────────────────────────────────────────────────────

export function ColDivider({ onDrag }: { onDrag: (dx: number) => void }) {
  const isDragging = useRef(false);
  const lastX = useRef(0);
  const [active, setActive] = useState(false);

  return (
    <div
      className="flex-shrink-0 relative group z-30"
      style={{ width: 6, cursor: 'col-resize' }}
      onPointerDown={e => {
        isDragging.current = true;
        setActive(true);
        lastX.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (!isDragging.current) return;
        const dx = e.clientX - lastX.current;
        lastX.current = e.clientX;
        onDrag(dx);
      }}
      onPointerUp={() => { isDragging.current = false; setActive(false); }}
      onPointerCancel={() => { isDragging.current = false; setActive(false); }}
    >
      {/* Visual line */}
      <div
        className="absolute inset-y-0 transition-all duration-100"
        style={{
          left: '50%',
          width: active ? 2 : 1,
          transform: 'translateX(-50%)',
          background: active ? 'rgba(99,102,241,0.65)' : 'rgba(63,63,70,0.65)',
        }}
      />
      {/* Grip dots on hover */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center gap-0.5 transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-70'}`}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="w-0.5 h-0.5 rounded-full bg-indigo-400/70" />
        ))}
      </div>
    </div>
  );
}

// ── ToolWorkspace ─────────────────────────────────────────────────────────
// The tool's body: the mode-swapping main area (debug / tutor / interview) plus
// the panel toggles and the timeline. Shared by /app (free practice) and
// /solve/:id (the Animation / Tutor / Interview tabs). Playback + keyboard nav
// live here so both hosts get them. Fills its flex-col parent — the host owns
// the outer height.

export default function ToolWorkspace() {
  const { isPlaying, stepForward, currentStep, playbackSpeed, appMode } = useExecutionStore();
  useKeyboardNav();

  const [codePct, setCodePct]           = useState(34);
  const [inspectorPct, setInspectorPct] = useState(22);
  const [aiLeftPct, setAiLeftPct]       = useState(48);  // left share in AI modes (chat / code)
  const containerRef = useRef<HTMLDivElement>(null);

  const totalWidth = () => containerRef.current?.getBoundingClientRect().width ?? 1;

  useEffect(() => {
    if (!isPlaying) return;
    const ms = 1400 / playbackSpeed;
    const id = setTimeout(stepForward, ms);
    return () => clearTimeout(id);
  }, [isPlaying, currentStep, stepForward, playbackSpeed]);

  return (
    <>
      {/* Views bar governs the memory panels — Debug mode only */}
      {appMode === 'debug' && <PanelToggleBar />}

      {/* Main area — swaps by mode */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">

        {appMode === 'debug' && (
          <>
            {/* Code panel */}
            <div style={{ width: `${codePct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
              <CodePanel />
            </div>
            <ColDivider onDrag={dx => {
              const delta = (dx / totalWidth()) * 100;
              setCodePct(p => Math.min(Math.max(p + delta, 15), 55));
            }} />
            {/* Memory canvas — flex-1 fills remaining space */}
            <MemoryCanvas />
            <ColDivider onDrag={dx => {
              const delta = (dx / totalWidth()) * 100;
              setInspectorPct(p => Math.min(Math.max(p - delta, 12), 45));
            }} />
            {/* Inspector panel */}
            <div style={{ width: `${inspectorPct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
              <InspectorPanel />
            </div>
          </>
        )}

        {/* Tutor: conversation is the hero (left); the live artifact (Animation |
            Code tabs) is on the right. */}
        {appMode === 'tutor' && (
          <>
            <div style={{ width: `${aiLeftPct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
              <TutorConversation />
            </div>
            <ColDivider onDrag={dx => {
              const delta = (dx / totalWidth()) * 100;
              setAiLeftPct(p => Math.min(Math.max(p + delta, 30), 65));
            }} />
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <ArtifactPanel />
            </div>
          </>
        )}

        {/* Interview: no animation — just the code and the interview chat. */}
        {appMode === 'interview' && (
          <>
            <div style={{ width: `${aiLeftPct}%` }} className="flex-shrink-0 flex flex-col overflow-hidden">
              <CodePanel readOnly />
            </div>
            <ColDivider onDrag={dx => {
              const delta = (dx / totalWidth()) * 100;
              setAiLeftPct(p => Math.min(Math.max(p + delta, 30), 65));
            }} />
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <InterviewConversation />
            </div>
          </>
        )}

      </div>

      <TimelineBar />
      <AmbiguityPanel />
    </>
  );
}
