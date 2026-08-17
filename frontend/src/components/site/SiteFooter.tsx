import { Link } from 'react-router-dom';

export default function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200/70 dark:border-zinc-800/70">
      <div className="mx-auto max-w-6xl px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
        <div className="flex items-center gap-2">
          <span className="text-violet-500">◈</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">DryRun</span>
        </div>
        <div className="flex items-center gap-5">
          <Link to="/app" className="hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">Playground</Link>
          <Link to="/learn" className="hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">Learn</Link>
          <a href="https://tally.so/r/vGJyED" target="_blank" rel="noreferrer" className="hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">Feedback</a>
        </div>
        <div className="text-zinc-400 dark:text-zinc-600">© {new Date().getFullYear()} DryRun</div>
      </div>
    </footer>
  );
}
