import { useEffect, useRef, useState } from 'react';
import { useExecutionStore } from '../store/executionStore';

// The Tutor's right pane: one running conversation. Per-step explains, free-text
// Q&A, and walkthrough beats all appear as messages; any message tied to a step
// is clickable and drives the animation (goToStep). The bottom timeline still
// scrubs. Grounded in the trace — the tutor narrates, never computes.
export default function TutorConversation() {
  const {
    trace, currentStep,
    tutorTranscript, explainLoading, explainError, walkLoading, walkError,
    explainStep, askQuestion, startWalkthrough, goToStep,
  } = useExecutionStore();
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [tutorTranscript.length, explainLoading, walkLoading]);

  if (!trace) return null;
  const busy = explainLoading || walkLoading;

  const ask = () => { const q = input.trim(); if (!q) return; askQuestion(q); setInput(''); };
  const walk = () => { const q = input.trim(); startWalkthrough(q || undefined); setInput(''); };

  return (
    <div data-tour="tutor-pane" className="flex flex-col h-full w-full border-l border-zinc-800/60 bg-[#111113] overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between flex-shrink-0 border-b border-zinc-800/60">
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono flex items-center gap-1.5">
          <span className="text-indigo-400/70">✦</span> Tutor
        </span>
        <span className="text-[8px] text-zinc-700 font-mono">grounded in the trace · never computed</span>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {tutorTranscript.length === 0 && !busy && (
          <div className="text-[11px] font-mono text-zinc-600 leading-relaxed">
            Ask about the program, get any step explained, or have me walk you through it. Messages
            tied to a step are clickable — they jump the animation there.
          </div>
        )}

        {tutorTranscript.map(msg => {
          const clickable = msg.step !== undefined;
          const isCurrent = clickable && msg.step === currentStep;
          if (msg.role === 'you') {
            return (
              <div key={msg.id} className="ml-6 rounded bg-zinc-800/50 px-2.5 py-1.5">
                <div className="text-[8px] font-mono uppercase tracking-widest text-zinc-500 mb-0.5">You</div>
                <div className="text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap">{msg.text}</div>
              </div>
            );
          }
          return (
            <div
              key={msg.id}
              onClick={clickable ? () => goToStep(msg.step!) : undefined}
              className={[
                'rounded px-2.5 py-2 border',
                isCurrent ? 'border-indigo-400/70 bg-indigo-500/15' : 'border-indigo-500/20 bg-indigo-500/8',
                clickable ? 'cursor-pointer hover:border-indigo-400/60' : '',
              ].join(' ')}
              title={clickable ? `Jump the animation to step ${msg.step! + 1}` : undefined}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono uppercase tracking-widest text-indigo-400/60">Tutor</span>
                {clickable && (
                  <span className={`text-[8px] font-mono ${isCurrent ? 'text-indigo-300' : 'text-zinc-600'}`}>
                    {isCurrent ? '● ' : ''}step {msg.step! + 1}
                  </span>
                )}
              </div>
              <div className="text-[11px] leading-relaxed text-zinc-200 whitespace-pre-wrap">{msg.text}</div>
            </div>
          );
        })}

        {busy && <div className="text-[10px] font-mono text-indigo-300/70">thinking…</div>}
        {(explainError || walkError) && (
          <div className="text-[10px] leading-relaxed text-amber-400/90 font-mono bg-amber-500/5 border border-amber-500/20 rounded px-2.5 py-2 whitespace-pre-wrap">
            {explainError || walkError}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input controls */}
      <div className="flex-shrink-0 border-t border-zinc-800/60 p-2.5 space-y-2">
        <div className="flex items-center gap-1.5">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') ask(); }}
            placeholder="ask about this program, or describe a part…"
            className="flex-1 bg-[#0d0d0f] border border-zinc-800 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-300 outline-none focus:border-indigo-500/50 placeholder:text-zinc-700"
          />
          <button
            onClick={ask}
            disabled={busy || !input.trim()}
            className="text-[10px] font-mono px-2 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-indigo-300 hover:border-indigo-500/40 disabled:opacity-40 transition-colors"
          >
            ask
          </button>
          <button
            onClick={walk}
            disabled={busy}
            className="text-[10px] font-mono px-2 py-1.5 rounded border border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-40 transition-colors whitespace-nowrap"
            title="Build a guided slideshow — scoped to your text if you typed a part, else the whole program"
          >
            walk me
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => explainStep(currentStep)}
            disabled={busy}
            className="flex-1 text-[10px] font-mono px-2 py-1.5 rounded border border-zinc-700 bg-zinc-800/40 text-zinc-300 hover:bg-zinc-800/70 disabled:opacity-50 transition-colors"
          >
            ✦ Explain step {currentStep + 1}
          </button>
          <button
            onClick={() => startWalkthrough()}
            disabled={busy}
            className="flex-1 text-[10px] font-mono px-2 py-1.5 rounded border border-zinc-700 bg-zinc-800/40 text-zinc-300 hover:bg-zinc-800/70 disabled:opacity-50 transition-colors"
          >
            ▶ Walk through the whole thing
          </button>
        </div>
      </div>
    </div>
  );
}
