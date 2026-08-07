import { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useExecutionStore } from '../../store/executionStore';
import { HeapBlock, MemorySnapshot, VariableValue } from '../../types/trace';
import { VizHint } from '../../types/ambiguity';
import HeapBlockComponent from './HeapBlock';
import { getVisualIdentity } from '../../utils/visualIdentity';
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
  const { currentFrame, prevFrame, vizHints, trace, currentStep } = useExecutionStore();
  const frame = currentFrame();
  const prev  = prevFrame();

  // Options for graph detection (derived from user viz hints).
  const skipVars = new Set(
    Object.entries(vizHints)
      .filter(([, h]) => h.kind === 'grid' || h.kind === 'struct')
      .map(([n]) => n),
  );
  const pairDestFields: Record<string, 'first' | 'second'> = {};
  for (const [n, h] of Object.entries(vizHints)) {
    if (h.kind === 'pair_order') pairDestFields[n] = h.destField;
  }

  // ── Graph-never-disappears ───────────────────────────────────────────────
  // Find the FIRST step in this run where a graph with LIVE traversal state
  // (a visited set or a current node) was detected. From that step onward we
  // keep showing the graph even after the traversal drains — the final step of
  // a BFS (queue empty, no current node) must still render the graph, not raw
  // adjacency arrays. Scrubbing back before that step correctly hides it (the
  // traversal hasn't begun yet). Computed once per trace, not per render.
  const firstGraphStep = useMemo(() => {
    if (!trace) return Infinity;
    for (let i = 0; i < trace.steps.length; i++) {
      const g = detectGraph(trace.steps[i].memory, { skip: skipVars, pairDestFields });
      if (g && (g.visited != null || g.currentNode != null)) return i;
    }
    return Infinity;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace, vizHints]);

  if (!frame) return null;

  const heap      = frame.memory.heap;
  const isCrash   = frame.event.type === 'crash';
  const crashAddr = isCrash
    ? (frame.event as { type: 'crash'; address?: string }).address
    : undefined;

  const entries = Object.entries(heap);

  // ── Graph detection runs REGARDLESS of heap contents ─────────────────────
  // A graph traversal (BFS/DFS) almost always allocates its adjacency vectors on
  // the heap, so gating the graph on an empty heap hid it exactly when it
  // mattered most. When the heap is non-empty we require EITHER live traversal
  // state OR that we're at/after the step where this run's traversal began
  // (`withinGraphPhase`) — so an incidental 2D array (e.g. a boolean DP table)
  // isn't mistaken for a graph, while a real graph never vanishes mid-run.
  const graph = detectGraph(frame.memory, { skip: skipVars, pairDestFields });
  const graphHasTraversal = !!graph && (graph.visited != null || graph.currentNode != null);
  const withinGraphPhase  = currentStep >= firstGraphStep;
  if (graph && (entries.length === 0 || graphHasTraversal || withinGraphPhase)) {
    return (
      <div className="flex-1 overflow-y-auto">
        <GraphViz data={graph} />
      </div>
    );
  }

  // ── Empty heap: try a segment tree from the stack ──
  if (entries.length === 0) {
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
              key={getVisualIdentity(block, addr)}
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
