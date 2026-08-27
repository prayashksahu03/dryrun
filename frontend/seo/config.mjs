// Single source of truth for anything that changes when the domain changes.
// Swap SITE_URL here and the sitemap, canonicals, OG tags and JSON-LD all follow.
export const SITE_URL  = process.env.SITE_URL || 'https://dryrun-z93y.vercel.app';
export const SITE_NAME = 'DryRun';
export const TAGLINE   = 'See your code run';
export const DESCRIPTION =
  'DryRun executes your C++ code for real and animates every step — memory, stack frames, ' +
  'arrays, graphs and trees — with an AI tutor grounded in the actual trace.';
export const OG_IMAGE = `${SITE_URL}/og.png`;
