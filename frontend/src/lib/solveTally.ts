// A local, device-only tally of what the student has solved in DryRun.
//
// This is deliberately NOT presented as an account-wide stat: OA owns the real
// `solves` table and the signed /api/solved/:id callback that will eventually
// feed it. Until that exists, a localStorage tally is the only honest source
// for "is this the first time you've cleared this one" — which is all the
// tiering logic actually needs.

const KEY = 'dryrun.solved.v1';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
  } catch {
    return [];   // private mode, blocked storage, corrupt value — all fine
  }
}

function write(ids: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(ids.slice(-500))); } catch { /* ignore */ }
}

export function hasSolved(id: string | number): boolean {
  return read().includes(String(id));
}

export interface SolveRecord {
  /** Total distinct problems cleared on this device, after recording. */
  total: number;
  /** False when this problem had already been cleared before. */
  firstTime: boolean;
  /** The milestone this solve crossed, if any (1, 10, 25, 50, 100 …). */
  milestone: number | null;
}

const MILESTONES = [1, 10, 25, 50, 100, 250, 500];

export function recordSolve(id: string | number): SolveRecord {
  const key = String(id);
  const ids = read();
  if (ids.includes(key)) return { total: ids.length, firstTime: false, milestone: null };
  ids.push(key);
  write(ids);
  const total = ids.length;
  return { total, firstTime: true, milestone: MILESTONES.includes(total) ? total : null };
}
