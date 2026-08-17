import { useEffect, useRef, useState } from 'react';
import { useExecutionStore } from '../store/executionStore';

// The Interview mode's right pane: a full-height mock-interview chat. The LLM
// interviewer questions the candidate about the code they ran — one question at a
// time, grounded in the code + trace — with the answer box pinned at the bottom.
export default function InterviewConversation() {
  const {
    trace, interview, interviewLoading, interviewError,
    startInterview, answerInterview, endInterview,
  } = useExecutionStore();
  const [answer, setAnswer] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [interview?.history.length, interviewLoading]);

  if (!trace) return null;

  const submit = () => { const a = answer.trim(); if (!a) return; answerInterview(a); setAnswer(''); };
  const history = interview?.history ?? [];
  const awaitingAnswer =
    !interviewLoading && history.length > 0 && history[history.length - 1].role === 'interviewer';

  return (
    <div data-tour="interview-pane" className="flex flex-col h-full w-full border-l border-zinc-800/60 bg-[#111113] overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between flex-shrink-0 border-b border-zinc-800/60">
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono flex items-center gap-1.5">
          <span className="text-emerald-400/70">◈</span> Interview
        </span>
        {interview ? (
          <button onClick={endInterview} className="text-[9px] font-mono text-zinc-500 hover:text-zinc-300">
            ✕ end
          </button>
        ) : (
          <span className="text-[8px] text-zinc-700 font-mono">mock interviewer · grounded in your code</span>
        )}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {!interview ? (
          <div className="space-y-3">
            <div className="text-[11px] font-mono text-zinc-600 leading-relaxed">
              A mock interviewer will ask about the code you just ran — design, complexity, edge
              cases — one question at a time, and react to your answers.
            </div>
            <button
              onClick={startInterview}
              disabled={interviewLoading}
              className="w-full text-left text-[11px] font-mono px-2.5 py-2 rounded border border-emerald-500/40 bg-emerald-500/12 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
            >
              {interviewLoading ? 'starting…' : '◈ Start interview'}
            </button>
          </div>
        ) : (
          <>
            {history.map((turn, i) =>
              turn.role === 'interviewer' ? (
                <div key={i} className="rounded border border-emerald-500/25 bg-emerald-500/8 px-2.5 py-2">
                  <div className="text-[8px] font-mono uppercase tracking-widest text-emerald-400/60 mb-1">Interviewer</div>
                  <div className="text-[11px] leading-relaxed text-zinc-200 whitespace-pre-wrap">{turn.content}</div>
                </div>
              ) : (
                <div key={i} className="rounded bg-zinc-800/50 px-2.5 py-2 ml-6">
                  <div className="text-[8px] font-mono uppercase tracking-widest text-zinc-500 mb-1">You</div>
                  <div className="text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap">{turn.content}</div>
                </div>
              ),
            )}
            {interviewLoading && <div className="text-[10px] font-mono text-emerald-300/70">interviewer is thinking…</div>}
          </>
        )}
        {interviewError && (
          <div className="text-[10px] leading-relaxed text-amber-400/90 font-mono bg-amber-500/5 border border-amber-500/20 rounded px-2.5 py-2 whitespace-pre-wrap">
            {interviewError}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Answer box (only once the interview is running) */}
      {interview && (
        <div className="flex-shrink-0 border-t border-zinc-800/60 p-2.5">
          <div className="flex items-start gap-1.5">
            <textarea
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder={awaitingAnswer ? 'type your answer… (Enter to send, Shift+Enter for newline)' : 'waiting for the interviewer…'}
              rows={2}
              disabled={!awaitingAnswer}
              className="flex-1 bg-[#0d0d0f] border border-zinc-800 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-300 outline-none focus:border-emerald-500/50 placeholder:text-zinc-700 resize-none disabled:opacity-50"
            />
            <button
              onClick={submit}
              disabled={!awaitingAnswer || !answer.trim()}
              className="text-[10px] font-mono px-2.5 py-1.5 rounded border border-emerald-500/40 bg-emerald-500/12 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
            >
              answer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
