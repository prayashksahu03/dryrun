import { useState } from 'react';
import { useExecutionStore } from '../store/executionStore';

// Grounded "Explain" tutor panel. The LLM never computes — it narrates the
// interpreter's real trace facts. On-demand only (button / question), cached
// per step, so it never auto-costs anything while you step through.
export default function ExplainPanel() {
  const {
    trace, currentStep,
    explainStep, askQuestion,
    explanationCache, qa,
    explainLoading, explainError,
  } = useExecutionStore();

  const [question, setQuestion] = useState('');

  if (!trace) return null;

  // Show this step's cached explanation if we have one — stepping never shows a
  // stale explanation from another step.
  const stepExplanation = explanationCache[`${currentStep}:step:`];

  const submitQuestion = () => {
    const q = question.trim();
    if (!q) return;
    askQuestion(q);
    setQuestion('');
  };

  return (
    <div className="flex-shrink-0 flex flex-col border-t border-zinc-800/60 max-h-[40%] overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-mono flex items-center gap-1.5">
          <span className="text-indigo-400/70">✦</span> Explain
        </span>
        <span className="text-[8px] text-zinc-700 font-mono">grounded in the trace · never computed</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
        {/* Explain this step */}
        <button
          onClick={() => explainStep(currentStep)}
          disabled={explainLoading}
          className="w-full text-left text-[10px] font-mono px-2 py-1.5 rounded border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50 transition-colors"
        >
          {explainLoading ? 'thinking…' : `✦ Explain step ${currentStep + 1}`}
        </button>

        {stepExplanation && (
          <div className="text-[11px] leading-relaxed text-zinc-300 font-sans bg-zinc-800/30 rounded px-2.5 py-2 whitespace-pre-wrap">
            {stepExplanation}
          </div>
        )}

        {explainError && (
          <div className="text-[10px] leading-relaxed text-amber-400/90 font-mono bg-amber-500/5 border border-amber-500/20 rounded px-2.5 py-2 whitespace-pre-wrap">
            {explainError}
          </div>
        )}

        {/* Ask about this program */}
        <div className="pt-1">
          <div className="flex items-center gap-1.5">
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitQuestion(); }}
              placeholder="ask about this program…"
              className="flex-1 bg-[#0d0d0f] border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-300 outline-none focus:border-indigo-500/50 placeholder:text-zinc-700"
            />
            <button
              onClick={submitQuestion}
              disabled={explainLoading || !question.trim()}
              className="text-[10px] font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-indigo-300 hover:border-indigo-500/40 disabled:opacity-40 transition-colors"
            >
              ask
            </button>
          </div>

          {qa && (
            <div className="mt-2 space-y-1">
              <div className="text-[10px] font-mono text-zinc-500">Q: {qa.q}</div>
              <div className="text-[11px] leading-relaxed text-zinc-300 font-sans bg-zinc-800/30 rounded px-2.5 py-2 whitespace-pre-wrap">
                {qa.a}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
