import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

export default function SiteNav() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md border-b border-zinc-200/70 dark:border-zinc-800/70 bg-white/80 dark:bg-[#09090b]/80">
      <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-[15px]">
          <span className="text-violet-500 text-lg leading-none">◈</span>
          <span className="text-zinc-900 dark:text-zinc-100">DryRun</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2 text-sm">
          <Link to="/learn" className="px-3 py-2 rounded-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors">
            Learn
          </Link>
          <a
            href="https://tally.so/r/vGJyED"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:block px-3 py-2 rounded-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
          >
            Feedback
          </a>
          <ThemeToggle />
          <Link
            to="/app"
            className="ml-1 px-4 py-2 rounded-md text-sm font-medium bg-violet-600 text-white hover:bg-violet-500 transition-colors shadow-sm"
          >
            Launch app
          </Link>
        </nav>
      </div>
    </header>
  );
}
