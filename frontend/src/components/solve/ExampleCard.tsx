import { ReactNode, useState } from 'react';

// A worked example, always as a pair. The whole point of this component is that
// the student never has to hunt for "what goes in / what comes out" inside a
// wall of prose.

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => { setDone(true); setTimeout(() => setDone(false), 1200); },
          () => { /* clipboard blocked — the text is selectable anyway */ },
        );
      }}
      title={`Copy ${label}`}
      className={`h-5 px-1.5 rounded text-[9px] font-mono transition-colors ${
        done ? 'text-green-400' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60'
      }`}
    >
      {done ? '✓ copied' : 'copy'}
    </button>
  );
}

function IOBlock({
  label, value, tone, actions,
}: { label: string; value: string; tone: 'in' | 'out'; actions?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[9px] font-mono uppercase tracking-[0.14em] ${tone === 'in' ? 'text-zinc-500' : 'text-green-500/80'}`}>
          {label}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {actions}
          <CopyButton value={value} label={label.toLowerCase()} />
        </div>
      </div>
      <pre className={`max-h-44 overflow-auto rounded-md px-2.5 py-2 text-[11.5px] font-mono leading-relaxed whitespace-pre border ${
        tone === 'in'
          ? 'bg-[#08080a] border-zinc-800/70 text-zinc-300'
          : 'bg-green-400/[0.05] border-green-400/15 text-green-300/90'
      }`}>
        {value.replace(/\n+$/, '') || ' '}
      </pre>
    </div>
  );
}

export default function ExampleCard({
  label, input, output, explanation, onUseInput,
}: {
  label: string;
  input: string;
  output: string;
  explanation?: ReactNode;
  /** Loads this input into the editor's stdin panel. Omitted when there is no
   *  editor to load it into (e.g. a preview surface). */
  onUseInput?: (input: string) => void;
}) {
  const [used, setUsed] = useState(false);
  return (
    <section className="my-4 rounded-lg border border-zinc-800/70 bg-[#0a0a0c] overflow-hidden">
      <header className="flex items-center gap-2 px-3 h-8 border-b border-zinc-800/60 bg-[#111113]">
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-violet-300/80">{label || 'Example'}</span>
        {onUseInput && (
          <button
            type="button"
            onClick={() => { onUseInput(input); setUsed(true); setTimeout(() => setUsed(false), 1400); }}
            className={`ml-auto h-5 px-2 rounded text-[9px] font-mono border transition-colors ${
              used
                ? 'text-green-400 border-green-400/30 bg-green-400/10'
                : 'text-zinc-500 border-zinc-700/60 hover:text-violet-200 hover:border-violet-500/40 hover:bg-violet-500/10'
            }`}
            title="Put this input into the editor's stdin panel"
          >
            {used ? '✓ in stdin' : '→ stdin'}
          </button>
        )}
      </header>
      <div className="p-3 grid gap-3">
        <IOBlock label="Input" value={input} tone="in" />
        <IOBlock label="Expected output" value={output} tone="out" />
        {explanation && (
          <div className="pt-1 border-t border-zinc-800/60">
            <div className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-600 mt-2 mb-1">Why</div>
            <div className="text-[12.5px] leading-relaxed text-zinc-400">{explanation}</div>
          </div>
        )}
      </div>
    </section>
  );
}
