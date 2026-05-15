import { Trace, VariableValue } from '../types/trace';
import { Ambiguity } from '../types/ambiguity';

export function detectAmbiguities(trace: Trace): Ambiguity[] {
  // Collect the LAST seen value for each variable name across all steps.
  // This ensures we inspect the fully-populated state (e.g. after resize/build)
  // rather than the empty initial state.
  const lastVars = new Map<string, VariableValue>();
  for (const step of trace.steps) {
    for (const frame of step.memory.stack) {
      for (const [name, val] of Object.entries(frame.variables)) {
        lastVars.set(name, val);
      }
    }
  }

  const result: Ambiguity[] = [];

  for (const [name, val] of lastVars.entries()) {

    // ── 1. Square 2D array → graph adjacency matrix OR plain grid ──────────
    if (val.kind === 'array' && val.rows && val.cols && val.rows === val.cols) {
      const n = val.rows;
      if (n >= 2 && n <= 12) {
        const raw = val.values as number[][];
        const allNonNeg =
          Array.isArray(raw) &&
          raw.every(row => Array.isArray(row) && row.slice(0, n).every(v => typeof v === 'number' && v >= 0));
        if (allNonNeg) {
          result.push({ id: `${name}:matrix_or_graph`, kind: 'matrix_or_graph', varName: name, matrixSize: n });
        }
      }
    }

    // ── 2. Struct with array fields → segment tree OR regular struct ────────
    if (val.kind === 'struct') {
      const fields = val.fields as Record<string, VariableValue | undefined>;

      // Already auto-detectable (n + tree) → skip
      const nF    = fields.n;
      const treeF = fields.tree;
      if (nF?.kind === 'int' && (nF as { value: number }).value > 0 && treeF?.kind === 'array') continue;

      // Skip pointer-linked structures (tree nodes, trie nodes)
      if (fields.left || fields.right || fields.children) continue;

      const arrayFields = Object.entries(fields)
        .filter(([, fv]) => fv?.kind === 'array' && (fv as { values: unknown[] }).values.length >= 4)
        .map(([fname]) => fname);

      if (arrayFields.length > 0) {
        result.push({ id: `${name}:struct_or_segtree`, kind: 'struct_or_segtree', varName: name, arrayFields });
      }
    }

    // ── 3. Adj list of pairs with genuinely ambiguous field order ───────────
    if (val.kind === 'array' && !val.rows && !val.cols) {
      type PairEl = { kind: 'struct'; fields: { first: { value: number }; second: { value: number } } };
      const outer = val.values as unknown as Array<{ kind: string; values: PairEl[] }>;
      const n3 = Array.isArray(outer) ? outer.length : 0;
      const hasPairs = n3 >= 2 && n3 <= 12 && outer.some(
        el => el?.kind === 'array' && Array.isArray(el.values) && el.values.length > 0 &&
          typeof el.values[0] === 'object' && (el.values[0] as PairEl)?.kind === 'struct',
      );

      if (hasPairs) {
        let firstCanBeDest = true;
        let secondCanBeDest = true;
        let sampleFirst: number | undefined;
        let sampleSecond: number | undefined;

        outerLoop:
        for (const el of outer) {
          if (!el || el.kind !== 'array' || !Array.isArray(el.values)) continue;
          for (const nb of el.values) {
            if (typeof nb !== 'object' || nb.kind !== 'struct' || !nb.fields) continue;
            const fv = nb.fields.first?.value;
            const sv = nb.fields.second?.value;
            if (sampleFirst  === undefined && typeof fv === 'number') sampleFirst  = fv;
            if (sampleSecond === undefined && typeof sv === 'number') sampleSecond = sv;
            if (typeof fv === 'number' && (fv < 0 || fv >= n3)) firstCanBeDest  = false;
            if (typeof sv === 'number' && (sv < 0 || sv >= n3)) secondCanBeDest = false;
            if (sampleFirst !== undefined && sampleSecond !== undefined) break outerLoop;
          }
        }

        if (firstCanBeDest && secondCanBeDest && sampleFirst !== undefined && sampleSecond !== undefined) {
          result.push({
            id: `${name}:pair_field_order`,
            kind: 'pair_field_order',
            varName: name,
            samplePair: [sampleFirst, sampleSecond],
          });
        }
      }
    }

    // ── 4. Standalone 1D int array that might be a segment tree ────────────
    // Catches global/local vector<int> segTree, seg, st, tree etc.
    if (val.kind === 'array' && !val.rows && !val.cols) {
      const values = val.values as unknown[];
      if (!Array.isArray(values) || values.length < 4) continue;
      if (typeof values[0] !== 'number') continue;   // must be plain ints

      const nameLower = name.toLowerCase();
      const SEGTREE_SUBSTRINGS = ['segtree', 'seg_tree', 'segment_tree'];
      const SEGTREE_EXACT      = ['seg', 'st', 'tree'];
      const hasSegtreeName =
        SEGTREE_SUBSTRINGS.some(k => nameLower.includes(k)) ||
        SEGTREE_EXACT.includes(nameLower);

      const size       = values.length;
      const inferredN  = size / 4;
      const looksLike4n = Number.isInteger(inferredN) && inferredN >= 2 && inferredN <= 500;

      if (hasSegtreeName || (looksLike4n && nameLower.length <= 4)) {
        result.push({
          id: `${name}:array_unknown`,
          kind: 'array_unknown',
          varName: name,
          arraySize: size,
        });
      }
    }
  }

  return result;
}
