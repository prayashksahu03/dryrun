import { useState } from 'react';
import { useExecutionStore } from '../store/executionStore';

// Grounded "Explain" tutor panel. The LLM never computes — it narrates the
// interpreter's real trace facts. Modes:
//   • Walk me through this — LLM picks key steps ("beats") and drives the
//     animation + code highlight while explaining each.
//   • Ask about a part — the student's doubt scopes a TARGETED walkthrough:
//     the LLM chooses the steps that resolve that doubt and walks through them.
//   • Explain this step — on-demand narration for the current step, cached.
export default function ExplainPanel() {
  const {
    trace, currentStep,
    explainStep, explanationCache,
    explainLoading, explainError,
    walkthrough, walkLoading, walkError,
    startWalkthrough, nextBeat, prevBeat, exitWalkthrough,
  } = useExecutionStore();

  const [doubt, setDoubt] = useState('');

  if (!trace) return null;

  const stepExplanation = explanationCache[`${currentStep}:step:`];
  const beat = walkthrough ? walkthrough.beats[walkthrough.idx] : null;

  const askDoubt = () => {
    const q = doubt.trim();
    if (!q) return;
    startWalkthrough(q);   // targeted walkthrough scoped to this doubt
    setDoubt('');
  };

  return (
    <div className="flex-shrink-0 flex flex-col border-t border-zinc-800/60 max-h-[48%] overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-mono flex items-center gap-1.5">
          <span className="text-indigo-400/70">✦</span> Tutor
        </span>
        <span className="text-[8px] text-zinc-700 font-mono">grounded in the trace · never computed</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
        {/* ── Active walkthrough (general or doubt-scoped) ───────────────── */}
        {walkthrough && beat && (
          <div className="rounded border border-indigo-500/40 bg-indigo-500/10 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono uppercase tracking-widest text-indigo-300/80">
                Tutor · beat {walkthrough.idx + 1}/{walkthrough.beats.length}
              </span>
              <button onClick={exitWalkthrough} className="text-[9px] font-mono text-zinc-500 hover:text-zinc-300">
                ✕ exit
              </button>
            </div>
            {walkthrough.question && (
              <div className="text-[9px] font-mono text-indigo-300/70 italic">
                answering: “{walkthrough.question}”
              </div>
            )}
            <div className="text-[12px] font-semibold text-indigo-200">{beat.title}</div>
            <div className="text-[11px] leading-relaxed text-zinc-200 whitespace-pre-wrap">{beat.narration}</div>
            <div className="text-[8px] font-mono text-zinc-500">showing step {beat.step + 1}</div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                onClick={prevBeat}
                disabled={walkthrough.idx === 0}
                className="text-[10px] font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-indigo-500/40 disabled:opacity-30 transition-colors"
              >
                ◀ prev
              </button>
              <button
                onClick={nextBeat}
                disabled={walkthrough.idx >= walkthrough.beats.length - 1}
                className="text-[10px] font-mono px-2 py-1 rounded border border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-30 transition-colors"
              >
                next ▶
              </button>
            </div>
          </div>
        )}

        {/* ── Ask about a specific part → targeted walkthrough ───────────── */}
        <div className="space-y-1.5">
          <div className="text-[9px] font-mono text-zinc-600">
            stuck on a part? describe it and I'll walk you through it:
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={doubt}
              onChange={e => setDoubt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') askDoubt(); }}
              placeholder="e.g. why does node 4 get visited before 3?"
              className="flex-1 bg-[#0d0d0f] border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-300 outline-none focus:border-indigo-500/50 placeholder:text-zinc-700"
            />
            <button
              onClick={askDoubt}
              disabled={walkLoading || !doubt.trim()}
              className="text-[10px] font-mono px-2 py-1 rounded border border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              walk me
            </button>
          </div>
          {!walkthrough && (
            <button
              onClick={() => startWalkthrough()}
              disabled={walkLoading}
              className="w-full text-left text-[10px] font-mono px-2 py-1.5 rounded border border-zinc-700 bg-zinc-800/40 text-zinc-300 hover:bg-zinc-800/70 disabled:opacity-50 transition-colors"
            >
              {walkLoading ? 'planning walkthrough…' : '▶ or walk me through the whole thing'}
            </button>
          )}
          {walkLoading && walkthrough === null && (
            <div className="text-[9px] font-mono text-indigo-300/70">planning walkthrough…</div>
          )}
          {walkError && (
            <div className="text-[10px] leading-relaxed text-amber-400/90 font-mono bg-amber-500/5 border border-amber-500/20 rounded px-2.5 py-2 whitespace-pre-wrap">
              {walkError}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800/50 my-1" />

        {/* ── Explain the current step ───────────────────────────────────── */}
        <button
          onClick={() => explainStep(currentStep)}
          disabled={explainLoading}
          className="w-full text-left text-[10px] font-mono px-2 py-1.5 rounded border border-zinc-700 bg-zinc-800/40 text-zinc-300 hover:bg-zinc-800/70 disabled:opacity-50 transition-colors"
        >
          {explainLoading ? 'thinking…' : `✦ Explain step ${currentStep + 1}`}
        </button>
        {stepExplanation && (
          <div className="text-[11px] leading-relaxed text-zinc-300 bg-zinc-800/30 rounded px-2.5 py-2 whitespace-pre-wrap">
            {stepExplanation}
          </div>
        )}
        {explainError && (
          <div className="text-[10px] leading-relaxed text-amber-400/90 font-mono bg-amber-500/5 border border-amber-500/20 rounded px-2.5 py-2 whitespace-pre-wrap">
            {explainError}
          </div>
        )}
      </div>
    </div>
  );
}
