import { Fragment, ReactNode, useMemo } from 'react';
import { Block, Span, parseInline, parseProblemBody } from '../../utils/markdown';
import ExampleCard from './ExampleCard';

// Renders the block tree from utils/markdown. Everything is real React nodes —
// no dangerouslySetInnerHTML anywhere, so a question body can never inject
// markup into the page.

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s: Span, i) => {
        switch (s.t) {
          case 'code':
            return (
              <code key={i} className="font-mono text-[0.92em] px-1 py-[1px] rounded bg-zinc-800/70 text-violet-200/90">
                {s.v}
              </code>
            );
          case 'strong': return <strong key={i} className="font-semibold text-zinc-100">{s.v}</strong>;
          case 'em':     return <em key={i} className="italic text-zinc-200">{s.v}</em>;
          default:       return <Fragment key={i}>{s.v}</Fragment>;
        }
      })}
    </>
  );
}

const HEADING_CLS: Record<number, string> = {
  1: 'text-[17px] font-semibold text-zinc-100 mt-5 mb-2',
  2: 'text-[13px] font-semibold text-zinc-200 mt-6 mb-2 uppercase tracking-[0.1em]',
  3: 'text-[12.5px] font-semibold text-zinc-300 mt-4 mb-1.5',
};

function renderBlock(b: Block, key: number, onUseInput?: (s: string) => void): ReactNode {
  switch (b.kind) {
    case 'heading': {
      const cls = HEADING_CLS[b.level] ?? 'text-[12px] font-semibold text-zinc-400 mt-3 mb-1';
      const Tag = (`h${Math.min(b.level + 1, 6)}` as unknown) as 'h2';
      return <Tag key={key} className={cls}><Inline text={b.text} /></Tag>;
    }
    case 'para':
      return (
        <p key={key} className="text-[13.5px] leading-[1.75] text-zinc-300/95 my-2.5">
          <Inline text={b.text} />
        </p>
      );
    case 'list': {
      const items = b.items.map((it, i) => (
        <li key={i} className="text-[13.5px] leading-[1.7] text-zinc-300/95 marker:text-zinc-600">
          <Inline text={it} />
        </li>
      ));
      return b.ordered
        ? <ol key={key} className="list-decimal pl-5 my-2.5 space-y-1">{items}</ol>
        : <ul key={key} className="list-disc pl-5 my-2.5 space-y-1">{items}</ul>;
    }
    case 'code':
      return (
        <pre key={key} className="my-3 rounded-md border border-zinc-800/70 bg-[#08080a] px-3 py-2.5 overflow-x-auto text-[11.5px] font-mono leading-relaxed text-zinc-300 whitespace-pre">
          {b.text}
        </pre>
      );
    case 'rule':
      return <hr key={key} className="my-5 border-zinc-800/70" />;
    case 'example':
      return (
        <ExampleCard
          key={key}
          label={b.label}
          input={b.input}
          output={b.output}
          onUseInput={onUseInput}
          explanation={
            b.explanation.length
              ? <>{b.explanation.map((eb, i) => renderBlock(eb, i, onUseInput))}</>
              : undefined
          }
        />
      );
    default:
      return null;
  }
}

export default function Markdown({
  source, onUseInput,
}: { source: string; onUseInput?: (s: string) => void }) {
  const blocks = useMemo(() => parseProblemBody(source), [source]);
  return <div>{blocks.map((b, i) => renderBlock(b, i, onUseInput))}</div>;
}
