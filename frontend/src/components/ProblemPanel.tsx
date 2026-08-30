import { useMemo, useState } from 'react';
import { useExecutionStore } from '../store/executionStore';
import {
  OAProblem, normalizeDifficulty, parseTopics, sampleCases,
} from '../types/problem';
import { hasMarkdownMarkers, looksLikeMarkdown, parseProblemBody } from '../utils/markdown';
import Markdown from './solve/Markdown';
import ExampleCard from './solve/ExampleCard';
import { DifficultyChip, TopicTags } from './solve/Chips';

// The "description" pane for /solve/:id.
//
// Two generations of question flow through here and both have to read well:
//
//   • Imported questions carry Markdown, a difficulty, topic tags and real test
//     cases — they get headings, folded input/output examples and a meta row.
//   • Legacy scraped questions carry a flat text blob and screenshots and
//     nothing else. They render exactly as they always did.
//
// Every element added for the first group is conditional. When a field is
// missing the element is not rendered at all — there is no empty box, no dash,
// and no "Difficulty: —".

export type { OAProblem } from '../types/problem';

export default function ProblemPanel({ problem }: { problem: OAProblem }) {
  const setStdinInput = useExecutionStore(s => s.setStdinInput);

  // `statement_md` is the widened, segment-per-section body (imported = clean,
  // legacy = segmented server-side). It is always Markdown, so it renders
  // through the block parser as distinct heading+body segments. When it's absent
  // we fall back to the flat `text` blob behind the strict looksLikeMarkdown
  // gate, so a scraped legacy blob is never reflowed and mangled.
  const statementMd = problem.statement_md?.trim() ?? '';
  const text = problem.text?.trim() ?? '';
  const body = statementMd || text;
  const isMarkdown = useMemo(
    () => (statementMd ? true : looksLikeMarkdown(text)),
    [statementMd, text],
  );
  const difficulty = normalizeDifficulty(problem.difficulty);
  const topics = parseTopics(problem.topics);
  const cases = sampleCases(problem);

  // The body's own worked examples win over the raw test-case table: they carry
  // the explanation prose. The table is only promoted to an Examples section
  // when the statement has none of its own.
  const bodyExamples = useMemo(
    () => (isMarkdown ? parseProblemBody(body).some(b => b.kind === 'example') : false),
    [isMarkdown, body],
  );
  const showCaseExamples = !bodyExamples && cases.length > 0;

  const hasMeta = Boolean(difficulty) || topics.length > 0 || Boolean(problem.role?.trim());
  const hasBody = body.length > 0;
  const images = problem.images ?? [];
  const editorial = problem.editorial?.trim() ?? '';

  return (
    <div className="flex flex-col h-full w-full bg-[#0d0d0f] border-r border-zinc-800/60 overflow-hidden">
      <div className="flex items-center gap-2 h-9 px-3 border-b border-zinc-800/60 flex-shrink-0">
        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">Problem</span>
        {problem.company_name && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/25">
            {problem.company_name}
          </span>
        )}
        {difficulty && (
          <span className="ml-auto">
            <DifficultyChip difficulty={difficulty} score={problem.difficulty_score} />
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        <h1 className="text-lg font-semibold text-zinc-100 mb-2 leading-snug">{problem.title}</h1>

        {hasMeta && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {problem.role?.trim() && (
              <span className="h-[22px] inline-flex items-center px-2 rounded-md text-[11px] font-mono text-zinc-500 bg-zinc-800/40 border border-zinc-800">
                {problem.role.trim()}
              </span>
            )}
            <TopicTags topics={topics} />
          </div>
        )}

        {hasBody && (
          isMarkdown
            ? <Markdown source={body} onUseInput={setStdinInput} />
            // Legacy flat text: preformatted, exactly as before. Guessing at
            // structure it never had would only mangle it.
            : <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-zinc-300 mb-5">{body}</pre>
        )}

        {showCaseExamples && (
          <section className="mt-5">
            <h2 className="text-[13px] font-semibold text-zinc-200 uppercase tracking-[0.1em] mb-1">Examples</h2>
            {cases.map((c, i) => (
              <ExampleCard
                key={c.id ?? i}
                label={`Example ${i + 1}`}
                input={c.input}
                output={c.expected_output}
                onUseInput={setStdinInput}
                explanation={c.explanation?.trim() ? <p>{c.explanation.trim()}</p> : undefined}
              />
            ))}
          </section>
        )}

        {images.length > 0 && (
          <div className="flex flex-col gap-3 mt-4">
            {images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`${problem.title} — figure ${i + 1}`}
                loading="lazy"
                className="max-w-full rounded-lg border border-zinc-800/70 bg-white"
              />
            ))}
          </div>
        )}

        {editorial && <Editorial text={editorial} />}

        {!hasBody && images.length === 0 && (
          <p className="text-zinc-500 text-sm font-mono">No problem content available.</p>
        )}
      </div>
    </div>
  );
}

// Behind a click, always. An editorial the student did not ask for is a spoiler.
function Editorial({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-6 rounded-lg border border-zinc-800/70 bg-[#0a0a0c] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 h-9 text-left hover:bg-zinc-800/30 transition-colors"
      >
        <span className={`text-[8px] text-zinc-600 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-400">Editorial</span>
        {!open && <span className="ml-auto text-[10px] font-mono text-amber-500/70">spoiler — solve it first</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-zinc-800/60">
          {hasMarkdownMarkers(text)
            ? <Markdown source={text} />
            : <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-zinc-300 mt-2">{text}</pre>}
        </div>
      )}
    </section>
  );
}
