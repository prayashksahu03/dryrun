import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { GUIDED_PROGRAMS } from '../data/guided';
import { useExecutionStore } from '../store/executionStore';

// Guided lessons. Clicking one loads it into the tool and opens the playground
// running it (reuses store.loadGuidedProgram + the guided-hint system).
export default function LearnPage() {
  const navigate = useNavigate();
  const loadGuidedProgram = useExecutionStore(s => s.loadGuidedProgram);

  const open = (program: (typeof GUIDED_PROGRAMS)[number]) => {
    loadGuidedProgram(program);   // sets source + runs (async; fine to fire-and-forget)
    navigate('/app');
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Learn by watching</h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Hand-picked programs with step-by-step hints at every key moment. Pick one — it opens in the
          playground and runs, with the tutor a click away.
        </p>
      </motion.div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {GUIDED_PROGRAMS.map((p, i) => (
          <motion.button
            key={p.id}
            onClick={() => open(p)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.3) }}
            className="group text-left rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-5 hover:border-violet-500/50 hover:bg-white dark:hover:bg-zinc-900/70 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="inline-block rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">
                {p.concept}
              </span>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-600">{p.hints.length} hints</span>
            </div>
            <h3 className="mt-3 text-lg font-semibold group-hover:text-violet-600 dark:group-hover:text-violet-300 transition-colors">
              {p.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{p.description}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 dark:text-violet-300">
              Open lesson <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
