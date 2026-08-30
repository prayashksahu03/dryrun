import { Difficulty } from '../../types/problem';

// Colour is never the only signal — the word is always there too. That is what
// makes these readable to a colour-blind student and in a screenshot.
const DIFF: Record<Difficulty, { label: string; cls: string }> = {
  easy:   { label: 'Easy',   cls: 'bg-green-400/12 text-green-400 border-green-400/30' },
  medium: { label: 'Medium', cls: 'bg-amber-400/12 text-amber-400 border-amber-400/30' },
  hard:   { label: 'Hard',   cls: 'bg-rose-400/12 text-rose-400 border-rose-400/30' },
};

export function DifficultyChip({ difficulty, score }: { difficulty: Difficulty; score?: number | null }) {
  const d = DIFF[difficulty];
  const hasScore = typeof score === 'number' && Number.isFinite(score) && score > 0;
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md border text-[11px] font-mono font-medium ${d.cls}`}
      title={hasScore ? `Difficulty ${d.label} · score ${score}/100` : `Difficulty: ${d.label}`}
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {d.label}
      {hasScore && <span className="opacity-55 tabular-nums">· {score}</span>}
    </span>
  );
}

export function TopicTags({ topics }: { topics: string[] }) {
  if (!topics.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {topics.map(t => (
        <span
          key={t}
          className="h-[22px] inline-flex items-center px-2 rounded-md text-[11px] font-mono text-zinc-400 bg-zinc-800/50 border border-zinc-700/50"
        >
          {t}
        </span>
      ))}
    </div>
  );
}
