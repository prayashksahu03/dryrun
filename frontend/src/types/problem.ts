// The OA question payload served by onlineassessments.tech at
// GET /api/problem/:id?t=<token>.
//
// Two generations of question live behind this one shape:
//
//   • LEGACY (~2,984 rows) — scraped screenshots. Only `title`, `company_name`,
//     `text` (flat, unformatted) and `images` are ever populated. Every field
//     below marked optional is genuinely absent for these.
//   • IMPORTED — carry `difficulty`, `topics`, `starter_code`, `editorial` and
//     real `test_cases`, and their `text` is Markdown.
//
// Everything the panel renders from the second group MUST be conditional: an
// absent field renders nothing at all, never an empty box or a dash.

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface OATestCase {
  id?: number;
  seq?: number;
  input: string;
  expected_output: string;
  /** 1 = shown to the student; 0 = held back. Absent is treated as a sample. */
  is_sample?: number | boolean | null;
  explanation?: string | null;
  confidence?: string | null;
  source?: string | null;
}

export interface OAProblem {
  id: number;
  title: string;
  company_name: string;
  company_tag: string;
  text: string;
  images: string[];

  // ── Widened payload (imported questions only) ──────────────────────────
  /**
   * The problem statement as Markdown. Imported questions carry a clean body;
   * legacy scraped rows are segmented server-side into `## Problem / Constraints
   * / Input / Output / Examples / …` so both render as distinct segments. When
   * absent the panel falls back to the flat `text` blob.
   */
  statement_md?: string | null;
  difficulty?: string | null;
  difficulty_score?: number | null;
  /** JSON array, or the raw JSON string straight out of SQLite. */
  topics?: string[] | string | null;
  starter_code?: string | null;
  editorial?: string | null;
  role?: string | null;
  test_cases?: OATestCase[] | null;
  /**
   * The visible sample cases the student may Run against. Preferred over
   * `test_cases` when present. Hidden cases are never in this payload.
   */
  sample_cases?: OATestCase[] | null;
  /** How many cases Submit grades against (samples + hidden). */
  total_cases?: number | null;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** Only ever returns a known bucket — an unrecognised label renders no chip. */
export function normalizeDifficulty(v: unknown): Difficulty | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  const hit = DIFFICULTIES.find(d => d === s);
  return hit ?? null;
}

/** `topics` arrives as a JSON array, a JSON-encoded string, or nothing. */
export function parseTopics(v: unknown): string[] {
  let arr: unknown = v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try { arr = JSON.parse(s); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map(t => (typeof t === 'string' ? t.trim() : ''))
    .filter(t => t.length > 0 && t.length < 40);
}

/** The cases the student is allowed to see. Held-back cases never reach the UI.
 *  The widened payload ships them as `sample_cases`; older shapes used
 *  `test_cases` with an `is_sample` flag. `sample_cases` wins when present. */
export function sampleCases(p: OAProblem | null): OATestCase[] {
  const source = p?.sample_cases?.length ? p.sample_cases : p?.test_cases;
  if (!source?.length) return [];
  return source
    .filter(c => typeof c?.input === 'string' && typeof c?.expected_output === 'string')
    .filter(c => c.is_sample === undefined || c.is_sample === null || Boolean(Number(c.is_sample)))
    .slice()
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}
