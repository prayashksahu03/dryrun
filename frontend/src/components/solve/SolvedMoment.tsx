import { useEffect, useMemo, useRef } from 'react';
import { Difficulty } from '../../types/problem';
import { SolveRecord } from '../../lib/solveTally';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// The passing moment, tier 2 and tier 3.
//
// Tier 1 — roughly everything — never reaches this component at all: it is the
// inline green wash on the test panel and nothing more. That restraint is what
// makes the rare card land. Rules taken from the approved mockup:
//
//   · never fires on load, only as the direct consequence of a run
//   · always ends on an autofocused primary next action
//   · Esc and click-outside always dismiss; nothing is trapped
//   · reduced motion collapses it to an instant state change, no confetti
//   · one confetti burst, 28 pieces, removed from the DOM, never loops
//
// Every number on the card is a fact we actually measured. Nothing here is
// invented — there is no percentile, no rank, no fabricated cohort.

export type SolvedTier = 'wash' | 'card' | 'milestone';

export interface SolvedFacts {
  tier: SolvedTier;
  title: string;
  passed: number;
  total: number;
  /** Runs taken on this problem in this session, including the one that passed. */
  attempts: number;
  elapsedMs: number;
  difficulty: Difficulty | null;
  tally: SolveRecord;
}

function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60000));
}

function copyFor(f: SolvedFacts): { verdict: string; headline: string; byline: string } {
  if (f.tier === 'milestone') {
    return {
      verdict: 'Milestone',
      headline: f.tally.total === 1
        ? 'First problem solved in DryRun'
        : `${f.tally.total} problems solved`,
      byline: f.tally.total === 1
        ? `“${f.title}” is on the board. Counted on this device.`
        : `“${f.title}” makes ${f.tally.total}. Counted on this device.`,
    };
  }
  if (f.difficulty === 'hard') {
    return {
      verdict: 'All sample cases passed',
      headline: 'Hard problem, cleared.',
      byline: `${f.passed}/${f.total} sample cases · ${f.attempts} run${f.attempts === 1 ? '' : 's'} · ${minutes(f.elapsedMs)} min.`,
    };
  }
  return {
    verdict: 'All sample cases passed',
    headline: f.attempts >= 3 ? `${f.attempts} runs. Worth it.` : 'Solved.',
    byline: `${f.passed}/${f.total} sample cases on “${f.title}” · ${minutes(f.elapsedMs)} min.`,
  };
}

const CONFETTI_COLORS = ['#8b5cf6', '#a78bfa', '#4ade80', '#fbbf24', '#f4f4f5'];

export default function SolvedMoment({
  facts, onClose, onPrimary, primaryLabel,
}: {
  facts: SolvedFacts;
  onClose: () => void;
  onPrimary: () => void;
  primaryLabel: string;
}) {
  const reduced = useReducedMotion();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const milestone = facts.tier === 'milestone';
  const { verdict, headline, byline } = copyFor(facts);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    // Autofocus the next action: the celebration converts into momentum
    // instead of dead-ending on a dismiss button.
    const t = setTimeout(() => primaryRef.current?.focus(), reduced ? 0 : 420);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [onClose, reduced]);

  const confetti = useMemo(() => {
    if (!milestone || reduced) return [];
    return Array.from({ length: 28 }, () => {
      const a = Math.random() * Math.PI * 2;
      const r = 90 + Math.random() * 140;
      return {
        dx: `${Math.round(Math.cos(a) * r)}px`,
        dy: `${Math.round(Math.sin(a) * r * 0.8 - 40)}px`,
        rot: `${Math.round(Math.random() * 720 - 360)}deg`,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        delay: `${Math.round(Math.random() * 90)}ms`,
      };
    });
  }, [milestone, reduced]);

  const accent = milestone ? 'amber' : 'green';
  const stroke = milestone ? '#fbbf24' : '#4ade80';

  const counters: { n: string; l: string }[] = milestone
    ? [
        { n: String(facts.tally.total), l: 'Solved' },
        { n: `${facts.passed}/${facts.total}`, l: 'Cases' },
        { n: String(facts.attempts), l: facts.attempts === 1 ? 'Run' : 'Runs' },
      ]
    : [
        { n: `${facts.passed}/${facts.total}`, l: 'Cases' },
        { n: String(facts.attempts), l: facts.attempts === 1 ? 'Run' : 'Runs' },
        { n: `${minutes(facts.elapsedMs)}m`, l: 'Elapsed' },
      ];

  return (
    <div
      role="presentation"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      className={`absolute inset-0 z-40 flex items-center justify-center p-5 bg-[#09090b]/72 backdrop-blur-[6px] ${reduced ? '' : 'dr-anim dr-fade'}`}
    >
      {confetti.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-10" aria-hidden>
          {confetti.map((c, i) => (
            <i
              key={i}
              className="dr-anim dr-confetti"
              style={{
                background: c.color,
                ['--dx' as string]: c.dx,
                ['--dy' as string]: c.dy,
                ['--rot' as string]: c.rot,
                animationDelay: c.delay,
              }}
            />
          ))}
        </div>
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-label={`${verdict}. ${headline}`}
        className={[
          'relative z-20 w-full max-w-[400px] text-center rounded-2xl px-7 pt-8 pb-6 bg-[#0d0d0f] border',
          'shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)]',
          milestone ? 'border-amber-400/32' : 'border-green-400/32',
          reduced ? '' : 'dr-anim dr-pop',
        ].join(' ')}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background: `radial-gradient(120% 80% at 50% 0%, ${milestone ? 'rgba(251,191,36,0.16)' : 'rgba(74,222,128,0.14)'}, transparent 62%)`,
          }}
        />

        <div className="relative">
          {milestone ? (
            <div className={`w-[74px] h-[74px] mx-auto mb-3.5 rounded-[20px] grid place-items-center text-[1.9rem] border border-amber-400/32 ${reduced ? '' : 'dr-anim dr-pop-late'}`}
              style={{ background: 'linear-gradient(140deg, rgba(251,191,36,0.22), rgba(251,191,36,0.06))' }}>
              ◆
            </div>
          ) : (
            <div className="w-16 h-16 mx-auto mb-4 relative">
              <svg width="64" height="64" viewBox="0 0 64 64" className="block -rotate-90">
                <circle cx="32" cy="32" r="28" fill="none" strokeWidth="3" stroke="rgba(74,222,128,0.32)" />
                <circle
                  cx="32" cy="32" r="28" fill="none" strokeWidth="3" strokeLinecap="round" stroke={stroke}
                  className={reduced ? '' : 'dr-anim dr-sweep'}
                  strokeDasharray="176"
                  strokeDashoffset={reduced ? 0 : 176}
                />
              </svg>
              <span className="absolute inset-0 grid place-items-center">
                <svg width="30" height="30" viewBox="0 0 30 30">
                  <path
                    d="M8 15.5l4.6 4.6L22.5 10" fill="none" stroke={stroke}
                    strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"
                    className={reduced ? '' : 'dr-anim dr-draw'}
                    strokeDasharray="34"
                    strokeDashoffset={reduced ? 0 : 34}
                  />
                </svg>
              </span>
            </div>
          )}

          <div className={`font-mono text-[11px] uppercase tracking-[0.2em] ${milestone ? 'text-amber-400' : 'text-green-400'} ${reduced ? '' : 'dr-anim dr-rise-1'}`}>
            {verdict}
          </div>
          <div className={`mt-1.5 text-[1.4rem] font-extrabold tracking-tight leading-tight text-zinc-100 ${reduced ? '' : 'dr-anim dr-rise-2'}`}>
            {headline}
          </div>
          <div className={`mt-2 text-[13px] text-zinc-400 leading-relaxed ${reduced ? '' : 'dr-anim dr-rise-3'}`}>
            {byline}
          </div>

          <div className={`flex gap-2 mt-5 ${reduced ? '' : 'dr-anim dr-rise-4'}`}>
            {counters.map(c => (
              <div key={c.l} className="flex-1 rounded-[10px] border border-zinc-800/70 bg-[#111113] px-2 py-2.5">
                <div className="text-[1.15rem] font-extrabold tracking-tight tabular-nums leading-snug text-zinc-100">{c.n}</div>
                <div className="font-mono text-[8.5px] uppercase tracking-[0.11em] text-zinc-500">{c.l}</div>
              </div>
            ))}
          </div>

          <div className={`flex gap-2 mt-5 ${reduced ? '' : 'dr-anim dr-rise-5'}`}>
            <button
              ref={primaryRef}
              type="button"
              onClick={onPrimary}
              className="flex-1 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold text-white bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 transition-colors shadow-[0_4px_18px_rgba(124,58,237,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] px-3.5 py-2.5 font-mono text-[11px] text-zinc-400 border border-zinc-800 hover:text-zinc-100 hover:bg-zinc-800/50 transition-colors"
            >
              Esc
            </button>
          </div>
          <div className="sr-only">Press Escape or click outside to dismiss.</div>
        </div>
      </div>
    </div>
  );
}
