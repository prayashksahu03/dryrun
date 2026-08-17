import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Braces, Sparkles, MessagesSquare, Play, Check } from 'lucide-react';

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
};

const FEATURES = [
  {
    icon: Braces,
    title: 'Visualize execution',
    body: 'Step through memory, the stack & heap, pointers, linked lists, trees, graphs (BFS/DFS/Dijkstra), grids and DP tables — animated from a real interpreter trace, not a canned demo.',
  },
  {
    icon: Sparkles,
    title: 'AI tutor',
    body: 'Ask about any step, or say “walk me through it.” The tutor narrates the key moments, drives the animation to each one, and only ever explains what actually happened.',
  },
  {
    icon: MessagesSquare,
    title: 'Mock interviewer',
    body: 'An interviewer grills you on the code you wrote — complexity, edge cases, design trade-offs — one question at a time, grounded in your program’s real behavior.',
  },
];

const STEPS = [
  { n: '01', title: 'Paste your code', body: 'Drop in C++ (or C / Python). Real programs, competitive-style — main() and all.' },
  { n: '02', title: 'Run it', body: 'A deterministic interpreter executes it and records every step of memory and control flow.' },
  { n: '03', title: 'Visualize, ask, or interview', body: 'Watch it animate, have the tutor explain the why, or sit a mock interview on it.' },
];

const CONCEPTS = ['Pointers', 'Linked lists', 'Recursion', 'Trees', 'Graphs · BFS / DFS', 'Dijkstra', 'Grids', 'DP tables', 'Union-Find', 'Binary search'];

export default function HomePage() {
  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* subtle violet glow */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-[-10%] h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-violet-500/20 blur-[120px] dark:bg-violet-600/20" />
        </div>

        <div className="mx-auto max-w-6xl px-5 pt-20 pb-14 text-center">
          <motion.div {...fadeUp}>
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-600 dark:text-violet-300">
              <Sparkles size={13} /> Grounded in real execution — never guessed
            </span>
          </motion.div>

          <motion.h1
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.05 }}
            className="mx-auto mt-6 max-w-3xl text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.05]"
          >
            See your code
            <span className="bg-gradient-to-r from-violet-500 to-indigo-500 bg-clip-text text-transparent"> actually run.</span>
          </motion.h1>

          <motion.p
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.1 }}
            className="mx-auto mt-5 max-w-2xl text-base sm:text-lg text-zinc-600 dark:text-zinc-400"
          >
            DryRun turns C++ and DSA code into step-by-step animations — memory, pointers, graphs, DP —
            with an AI tutor that explains the <em>why</em> and a mock interviewer that quizzes you on
            your own code.
          </motion.p>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.15 }}
            className="mt-8 flex items-center justify-center gap-3"
          >
            <Link to="/app" className="group inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-500 transition-colors shadow-sm">
              Try it free <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link to="/learn" className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors">
              Browse lessons
            </Link>
          </motion.div>
        </div>

        {/* ── Product preview (a dark 'screenshot' of the tool) ────────── */}
        <motion.div
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.2 }}
          className="mx-auto max-w-5xl px-5 pb-20"
        >
          <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] shadow-2xl shadow-violet-950/20 overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 h-9">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
              <span className="ml-3 text-[11px] font-mono text-zinc-500">main.cpp — bfs</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 min-h-[260px]">
              {/* code */}
              <pre className="hidden sm:block border-r border-zinc-800 p-4 text-[11px] font-mono leading-relaxed text-zinc-400 overflow-hidden">
{`while (!q.empty()) {
  int u = q.front();
  q.pop();
`}<span className="rounded bg-violet-500/15 text-zinc-200">{`  for (int v : graph[u]) {`}</span>{`
    if (!visited[v]) {
      visited[v] = true;
      q.push(v);
    }
  }
}`}
              </pre>
              {/* mini animated graph */}
              <div className="relative flex items-center justify-center p-6">
                <svg viewBox="0 0 220 180" className="w-full max-w-[240px]">
                  <line x1="110" y1="30" x2="55" y2="90" stroke="rgba(99,102,241,0.4)" strokeWidth="1.5" />
                  <line x1="110" y1="30" x2="165" y2="90" stroke="rgba(99,102,241,0.4)" strokeWidth="1.5" />
                  <line x1="55" y1="90" x2="90" y2="150" stroke="rgba(99,102,241,0.4)" strokeWidth="1.5" />
                  <line x1="165" y1="90" x2="130" y2="150" stroke="rgba(99,102,241,0.4)" strokeWidth="1.5" />
                  <line x1="55" y1="90" x2="165" y2="90" stroke="rgba(99,102,241,0.25)" strokeWidth="1.5" />
                  {[
                    { x: 110, y: 30, n: 0, c: '#34d399' },
                    { x: 55, y: 90, n: 1, c: '#34d399' },
                    { x: 165, y: 90, n: 2, c: '#fbbf24' },
                    { x: 90, y: 150, n: 3, c: '#818cf8' },
                    { x: 130, y: 150, n: 4, c: '#3f3f46' },
                  ].map(v => (
                    <g key={v.n}>
                      <circle cx={v.x} cy={v.y} r="16" fill="#0d0d0f" stroke={v.c} strokeWidth="2" />
                      <text x={v.x} y={v.y + 4} textAnchor="middle" fontSize="12" fontFamily="monospace" fill="#e4e4e7">{v.n}</text>
                    </g>
                  ))}
                </svg>
                <span className="absolute bottom-3 left-4 text-[10px] font-mono text-zinc-600">6 nodes · undirected · BFS</span>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <motion.div {...fadeUp} className="grid gap-5 sm:grid-cols-3">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-6">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-300">
                <f.icon size={20} />
              </div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{f.body}</p>
            </div>
          ))}
        </motion.div>
      </section>

      {/* ── How it works ────────────────────────────────────────────── */}
      <section className="border-y border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/60 dark:bg-zinc-900/20">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <motion.h2 {...fadeUp} className="text-2xl sm:text-3xl font-bold tracking-tight text-center">How it works</motion.h2>
          <motion.div {...fadeUp} className="mt-10 grid gap-8 sm:grid-cols-3">
            {STEPS.map(s => (
              <div key={s.n}>
                <div className="text-sm font-mono font-semibold text-violet-500">{s.n}</div>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{s.body}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Concepts ────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-16 text-center">
        <motion.h2 {...fadeUp} className="text-2xl sm:text-3xl font-bold tracking-tight">Built for the problems you actually solve</motion.h2>
        <motion.div {...fadeUp} className="mt-8 flex flex-wrap justify-center gap-2.5">
          {CONCEPTS.map(c => (
            <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 px-3.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              <Check size={13} className="text-violet-500" /> {c}
            </span>
          ))}
        </motion.div>
      </section>

      {/* ── Closing CTA ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <motion.div {...fadeUp} className="relative overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-600/10 to-indigo-600/10 px-8 py-14 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Stop tracing code in your head.</h2>
          <p className="mx-auto mt-3 max-w-xl text-zinc-600 dark:text-zinc-400">Paste a program and watch it come alive — free, no signup.</p>
          <Link to="/app" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-500 transition-colors">
            <Play size={15} /> Launch the playground
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
