import { AnimatePresence } from 'framer-motion';
import { useExecutionStore } from '../../store/executionStore';
import { HeapBlock, MemorySnapshot, VariableValue } from '../../types/trace';
import { VizHint } from '../../types/ambiguity';
import HeapBlockComponent from './HeapBlock';
import TreeView from './TreeView';
import TrieView, { findTrieRoot } from './TrieView';
import GraphViz, { detectGraph } from '../graph/GraphViz';
import SegTreeViz from '../arrays/SegTreeViz';

function isTreeHeap(heap: Record<string, HeapBlock>): boolean {
  return Object.values(heap).some(
    b => b.state === 'allocated' && 'left' in b.fields && 'right' in b.fields,
  );
}

function isTrieHeap(heap: Record<string, HeapBlock>): boolean {
  return Object.values(heap).some(
    b =>
      b.state === 'allocated' &&
      b.fields['children']?.kind === 'array' &&
      (b.fields['children'].values as unknown[]).length === 26,
  );
}

function detectSegTree(
  memory: MemorySnapshot,
  vizHints: Record<string, VizHint>,
): { name: string; value: VariableValue & { kind: 'struct' }; treeFieldName: string; nOverride?: number; indexBase: 0 | 1 } | null {
  for (let fi = memory.stack.length - 1; fi >= 0; fi--) {
    const frame = memory.stack[fi];
    const vars  = frame.variables;
    for (const [name, val] of Object.entries(vars)) {
      if (val.kind !== 'struct') continue;

      // Auto-detect: has n + tree
      const nF    = val.fields.n;
      const treeF = val.fields.tree;
      if (nF?.kind === 'int' && nF.value > 0 && treeF?.kind === 'array') {
        return { name, value: val as VariableValue & { kind: 'struct' }, treeFieldName: 'tree', indexBase: 1 };
      }

      // Hint-based: user explicitly marked this struct as a segtree
      const hint = vizHints[name];
      if (hint?.kind === 'segtree') {
        const { arrayField, indexBase } = hint;
        const arrayF = val.fields[arrayField];
        if (!arrayF || arrayF.kind !== 'array') continue;

        // Find n from struct field or local frame variables
        let nOverride: number | undefined;
        if (nF?.kind === 'int' && nF.value > 0) {
          nOverride = nF.value;
        } else {
          for (const vname of ['n', 'sz', 'size', 'N']) {
            const v = vars[vname];
            if (v?.kind === 'int' && v.value > 0) { nOverride = v.value; break; }
          }
        }

        if (nOverride) {
          return { name, value: val as VariableValue & { kind: 'struct' }, treeFieldName: arrayField, nOverride, indexBase };
        }
      }
    }
  }
  return null;
}

const TREE_NODE_VARS = ['node', 'curr', 'current', 'p', 'q', 'ptr', 'temp', 'tmp', 'n'];

function findCurrentTreeNode(
  memory: MemorySnapshot,
  heap: Record<string, HeapBlock>,
): string | null {
  for (let fi = memory.stack.length - 1; fi >= 0; fi--) {
    const frame = memory.stack[fi];
    for (const name of TREE_NODE_VARS) {
      const v: VariableValue | undefined = frame.variables[name];
      if (!v || v.kind !== 'pointer' || !v.address) continue;
      const block = heap[v.address];
      if (block && block.state === 'allocated' && 'left' in block.fields) {
        return v.address;
      }
    }
  }
  return null;
}

export default function HeapZone() {
  const { currentFrame, prevFrame, vizHints } = useExecutionStore();
  const frame = currentFrame();
  const prev  = prevFrame();
  if (!frame) return null;

  const heap      = frame.memory.heap;
  const isCrash   = frame.event.type === 'crash';
  const crashAddr = isCrash
    ? (frame.event as { type: 'crash'; address?: string }).address
    : undefined;

  const entries = Object.entries(heap);

  // ── Empty heap: try to show a graph or segment tree from stack ──
  if (entries.length === 0) {
    // Build skip set (variables user marked as non-graph) and pair dest overrides
    const skipVars = new Set(
      Object.entries(vizHints)
        .filter(([, h]) => h.kind === 'grid' || h.kind === 'struct')
        .map(([n]) => n),
    );
    const pairDestFields: Record<string, 'first' | 'second'> = {};
    for (const [n, h] of Object.entries(vizHints)) {
      if (h.kind === 'pair_order') pairDestFields[n] = h.destField;
    }

    const graph = detectGraph(frame.memory, { skip: skipVars, pairDestFields });
    if (graph) {
      return (
        <div className="flex-1 overflow-y-auto">
          <GraphViz data={graph} />
        </div>
      );
    }

    const segTree = detectSegTree(frame.memory, vizHints);
    if (segTree) {
      let prevValue: VariableValue | undefined;
      if (prev) {
        for (const pf of prev.memory.stack) {
          const v = pf.variables[segTree.name];
          if (v) { prevValue = v; break; }
        }
      }
      return (
        <div className="flex-1 overflow-y-auto px-2 pt-2">
          <SegTreeViz
            name={segTree.name}
            value={segTree.value}
            prevValue={prevValue}
            treeFieldName={segTree.treeFieldName}
            nOverride={segTree.nOverride}
            indexBase={segTree.indexBase}
          />
        </div>
      );
    }

    // Standalone 1D array marked as segtree_flat by user
    for (let fi = frame.memory.stack.length - 1; fi >= 0; fi--) {
      const frameVars = frame.memory.stack[fi].variables;
      for (const [varName, val] of Object.entries(frameVars)) {
        const hint = vizHints[varName];
        if (hint?.kind !== 'segtree_flat') continue;
        if (val.kind !== 'array' || val.rows || val.cols) continue;

        const rawArr = (val.values as unknown[]).filter(v => typeof v === 'number') as number[];
        if (rawArr.length < 4) continue;

        // Find n: from local frame variable, fallback to size/4
        let n = 0;
        for (const vname of ['n', 'sz', 'size', 'N']) {
          const v = frameVars[vname];
          if (v?.kind === 'int' && v.value > 0) { n = v.value; break; }
        }
        if (!n) n = Math.round(rawArr.length / 4);

        const prevRaw = prev?.memory.stack[fi]?.variables[varName];
        const prevArr = prevRaw?.kind === 'array'
          ? (prevRaw.values as unknown[]).filter(v => typeof v === 'number') as number[]
          : undefined;

        return (
          <div className="flex-1 overflow-y-auto px-2 pt-2">
            <SegTreeViz
              name={varName}
              rawTreeArr={rawArr}
              rawPrevTreeArr={prevArr}
              nOverride={n}
              indexBase={hint.indexBase}
            />
          </div>
        );
      }
    }
    return (
      <div className="text-zinc-800 text-xs font-mono">no heap allocations yet</div>
    );
  }

  // ── Trie (heap blocks with children[26] pointer array) ──
  if (isTrieHeap(heap)) {
    const rootAddr = findTrieRoot(heap);
    // Find the active trie node: look for 'curr' / 'node' pointer vars in any frame
    let currentNodeAddr: string | null = null;
    for (let fi = frame.memory.stack.length - 1; fi >= 0; fi--) {
      const vars = frame.memory.stack[fi].variables;
      for (const name of ['curr', 'current', 'node', 'ptr', 'p']) {
        const v = vars[name];
        if (v?.kind === 'pointer' && v.address && v.address !== rootAddr) {
          currentNodeAddr = v.address;
          break;
        }
      }
      if (currentNodeAddr) break;
    }
    return (
      <div className="flex-1 flex items-start justify-center min-h-0 pt-2">
        <TrieView heap={heap} crashAddr={crashAddr} currentNodeAddr={currentNodeAddr} />
      </div>
    );
  }

  // ── Binary tree (heap blocks with left/right pointer fields) ──
  if (isTreeHeap(heap)) {
    const currentNodeAddr = findCurrentTreeNode(frame.memory, heap);
    return (
      <div className="flex-1 flex items-start justify-center min-h-0">
        <TreeView heap={heap} crashAddr={crashAddr} currentNodeAddr={currentNodeAddr} />
      </div>
    );
  }

  // ── Default: wrapping grid for linked-list / flat heap ──
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-wrap gap-4 content-start min-h-[80px]">
        <AnimatePresence>
          {entries.map(([addr, block]) => (
            <HeapBlockComponent
              key={addr}
              address={addr}
              block={block}
              isCrashTarget={addr === crashAddr}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
