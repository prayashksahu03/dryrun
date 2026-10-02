import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';

// Bump the version when the announcement changes, so people who dismissed the old one see the new one.
const DISMISS_KEY = 'dryrun.campusBanner.v1.dismissed';
const FEEDBACK_URL = 'https://tally.so/r/vGJyED';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Storage can be blocked (private mode, strict cookie settings); just show the banner.
    return false;
  }
}

export default function CampusCollabBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Dismissal then lasts for this visit only.
    }
  };

  return (
    <div className="border-b border-violet-500/20 bg-violet-500/10">
      <div className="mx-auto max-w-6xl px-5 py-2.5 flex items-center gap-3 text-sm">
        <span className="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
          Campus
        </span>
        <p className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">DryRun × IIT Bombay coding club</span>
          <span className="hidden sm:inline"> · a collab is in the works.</span>{' '}
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-1 font-medium text-violet-600 dark:text-violet-300 hover:underline"
          >
            Want DryRun at your club?
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </a>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="shrink-0 rounded-md p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-violet-500/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
