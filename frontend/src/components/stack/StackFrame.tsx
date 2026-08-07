import { motion } from 'framer-motion';
import { StackFrameData, VariableValue } from '../../types/trace';
import { useExecutionStore } from '../../store/executionStore';
import StackVariable from './StackVariable';
import { getVisualIdentity } from '../../utils/visualIdentity';
import ArrayViz, { ArrayPointer } from '../arrays/ArrayViz';
import StringViz from '../arrays/StringViz';
import HeapTreeViz from '../arrays/HeapTreeViz';
import { StackViz, QueueViz } from '../arrays/StackQueueViz';
import { SetViz, MapViz } from '../arrays/SetViz';
import DSUViz from '../arrays/DSUViz';
import BITViz from '../arrays/BITViz';

// Variable names that represent array indices/pointers
const INDEX_NAMES = new Set([
  'i', 'j', 'k', 'l', 'r', 'p', 'q',
  'left', 'right', 'mid', 'lo', 'hi',
  'start', 'end', 'ptr', 'idx', 'pos',
  'slow', 'fast', 'head', 'tail', 'curr',
]);

// DSU parent array names → render as forest
const DSU_NAMES = new Set(['parent', 'par', 'dsu', 'fa', 'root', 'id', 'f']);
// BIT/Fenwick array names → render with arc overlay (not 'tree' — too generic, clashes with segtree)
const BIT_NAMES = new Set(['bit', 'BIT', 'fenwick', 'fen', 'bit_tree', 'bitree']);

// Left-boundary pointer names (sliding window left edge)
const LEFT_NAMES  = new Set(['left', 'lo', 'l', 'start', 'slow']);
// Right-boundary pointer names (sliding window right edge)
const RIGHT_NAMES = new Set(['right', 'hi', 'r', 'end', 'fast']);

function computePointers(frame: StackFrameData, arrName: string, arrLen: number): ArrayPointer[] {
  const result: ArrayPointer[] = [];
  for (const [name, val] of Object.entries(frame.variables)) {
    if (name === arrName) continue;
    if (!INDEX_NAMES.has(name)) continue;
    const v = val.kind === 'int' ? val.value : null;
    if (typeof v === 'number' && v >= 0 && v < arrLen) {
      result.push({ name, idx: v });
    }
  }
  return result;
}

function computeWindow(
  frame: StackFrameData, arrLen: number
): { left: number; right: number } | null {
  let leftIdx: number | null  = null;
  let rightIdx: number | null = null;
  for (const [name, val] of Object.entries(frame.variables)) {
    if (val.kind !== 'int') continue;
    const v = val.value;
    if (LEFT_NAMES.has(name) && v >= 0 && v < arrLen) leftIdx  = v;
    if (RIGHT_NAMES.has(name) && v >= 0 && v < arrLen) rightIdx = v;
  }
  if (leftIdx !== null && rightIdx !== null && leftIdx <= rightIdx) {
    return { left: leftIdx, right: rightIdx };
  }
  return null;
}

// Serialize a VariableValue for diff comparison — exclude lastWrite since it
// changes on every array write even when the logical values haven't changed.
function valueHash(v: VariableValue): string {
  if (v.kind === 'array') {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { lastWrite: _lw, ...rest } = v;
    return JSON.stringify(rest);
  }
  return JSON.stringify(v);
}

export default function StackFrameComponent({
  frame,
  isActive,
}: {
  frame: StackFrameData;
  isActive: boolean;
}) {
  const prevFrame = useExecutionStore(s => s.prevFrame());
  const vizHints  = useExecutionStore(s => s.vizHints);

  // Pilot 1 (semantic pilot): consume the DECLARED written cell from the step's
  // cause chain instead of the bespoke lastWrite field. When the active step
  // declares WRITE(cell{name,index}), the grid highlights that exact cell — the
  // same fact that drives the cause ribbon, so ribbon and grid can't drift.
  const curEvent = useExecutionStore(s => s.currentFrame()?.event);
  const declaredWrites: Record<string, number[]> = {};
  if (isActive && curEvent && curEvent.type === 'assign' && curEvent.cause) {
    for (const op of curEvent.cause) {
      if (op.op === 'WRITE' && op.ref.kind === 'cell' && op.ref.name && op.ref.index != null) {
        declaredWrites[op.ref.name] = [op.ref.index];
      }
    }
  }

  // Find this function's variables in the previous step (matched by function name)
  const prevVars = prevFrame?.memory.stack
    .find(f => f.function === frame.function)?.variables ?? {};

  // A variable "changed" if it existed in prev AND its serialised value differs.
  // New declarations (not in prevVars) don't trigger the change glow.
  const hasChanged = (name: string, val: VariableValue): boolean => {
    const prev = prevVars[name];
    if (!prev) return false;
    return valueHash(prev) !== valueHash(val);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: isActive ? 1 : 0.55, y: 0 }}
      exit={{ opacity: 0, y: -12, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      layout
      className="rounded overflow-hidden flex-shrink-0"
      style={{
        border: isActive
          ? '1px solid rgba(99,102,241,0.4)'
          : '1px solid rgba(99,102,241,0.12)',
        background: isActive
          ? 'rgba(15, 23, 41, 0.95)'
          : 'rgba(12, 14, 28, 0.7)',
        boxShadow: isActive ? '0 0 0 1px rgba(99,102,241,0.08), 0 4px 16px rgba(99,102,241,0.06)' : 'none',
      }}
    >
      {/* Frame header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b"
        style={{
          borderColor: isActive ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.07)',
          background:  isActive ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.03)',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: isActive ? 'rgba(129,140,248,0.8)' : 'rgba(99,102,241,0.3)' }}
          />
          <span
            className="text-[10px] font-mono font-semibold tracking-wide"
            style={{ color: isActive ? 'rgba(165,180,252,0.9)' : 'rgba(99,102,241,0.5)' }}
          >
            {frame.function}()
          </span>
          {isActive && (
            <span className="text-[8px] font-mono text-indigo-400/50 border border-indigo-500/20 px-1 rounded">
              active
            </span>
          )}
        </div>
        <span className="text-zinc-700 text-[9px] font-mono">line {frame.line}</span>
      </div>

      {/* Variables */}
      <div className="px-1.5 py-1.5 space-y-0.5 relative">
        {Object.keys(frame.variables).length === 0 && (
          <div className="text-zinc-700 text-[10px] font-mono px-2">no locals</div>
        )}
        {(() => {
          // Render OBJECTS, not names. A reference shares its target's oid, so
          // fold it into the target's row as an extra nameplate — one box, two
          // names. ("The nameplates are just bindings; the card is the object.")
          const oidOf = (v: VariableValue) => getVisualIdentity(v);
          const mergedAway = new Set<string>();
          const aliasesByName: Record<string, string[]> = {};
          for (const [nm, v] of Object.entries(frame.variables)) {
            if (v.kind === 'ref') {
              const tv = frame.variables[v.target];
              if (tv && oidOf(v) && oidOf(v) === oidOf(tv)) {
                mergedAway.add(nm);
                (aliasesByName[v.target] ??= []).push(nm);
              }
            }
          }
          return Object.entries(frame.variables).map(([name, val]) => {
          if (mergedAway.has(name)) return null;  // folded into its target's card
          if (name.startsWith('__')) return null; // internal machinery (e.g. range-for iterator)
          if (val.kind === 'set' || val.kind === 'multiset') {
            return (
              <div key={name} className="px-1.5 pb-1">
                <SetViz name={name} entries={val.data} label={val.kind === 'multiset' ? 'multiset' : undefined} />
              </div>
            );
          }
          if (val.kind === 'map') {
            return (
              <div key={name} className="px-1.5 pb-1">
                <MapViz name={name} data={val.data} />
              </div>
            );
          }
          if (val.kind === 'iterator') {
            return null; // iterators are impl-detail variables; skip display
          }
          if (val.kind === 'struct') {
            // Render struct as an expandable group: name on top, fields indented below
            return (
              <div key={name} className="px-1 py-0.5">
                <div className="text-zinc-500 text-[10px] font-mono px-1 mb-0.5">{name}</div>
                <div
                  className="ml-2 pl-2 space-y-0.5"
                  style={{ borderLeft: '1px solid rgba(99,102,241,0.2)' }}
                >
                  {Object.entries(val.fields).map(([fieldName, fieldVal]) => (
                    <StackVariable
                      key={fieldName}
                      frameName={frame.function}
                      name={`${name}.${fieldName}`}
                      value={fieldVal}
                      changed={hasChanged(name, val)}
                    />
                  ))}
                </div>
              </div>
            );
          }
          if (val.kind === 'array') {
            const ctype: string = val.ctype ?? '';
            const isMinHeap: boolean = val.min_heap ?? false;
            const isPQ    = ctype.includes('priority_queue');
            const isStack = ctype.includes('stack') && !ctype.includes('priority');
            const isQueue = ctype.includes('queue') || ctype.includes('deque');

            if (isPQ) {
              return (
                <div key={name} className="px-1.5 pb-1">
                  <HeapTreeViz
                    name={name}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    values={val.values as any[]}
                    lastWrite={val.lastWrite}
                    isMinHeap={isMinHeap}
                  />
                </div>
              );
            }
            if (isStack) {
              return (
                <div key={name} className="px-1.5 pb-1">
                  <StackViz
                    name={name}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    values={val.values as any[]}
                    lastWrite={val.lastWrite}
                  />
                </div>
              );
            }
            if (isQueue) {
              return (
                <div key={name} className="px-1.5 pb-1">
                  <QueueViz
                    name={name}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    values={val.values as any[]}
                    lastWrite={val.lastWrite}
                  />
                </div>
              );
            }

            // DSU parent-array detection (1D, all values in [0, n))
            if (!val.rows && !val.cols && DSU_NAMES.has(name)) {
              const vals = val.values as number[];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const toIdx = (v: unknown) => { const x = typeof v === 'number' ? v : (v as any)?.value ?? 0; return typeof x === 'number' ? x : 0; };
              const allInRange = vals.length > 0 && vals.every(v => { const x = toIdx(v); return x >= 0 && x < vals.length; });
              // Reject all-same arrays (e.g. zero-initialized globals before init() runs)
              const allSame = vals.length > 1 && vals.every(v => toIdx(v) === toIdx(vals[0]));
              const isDSU = allInRange && !allSame;
              if (isDSU) {
                return (
                  <div key={name} className="px-1.5 pb-1">
                    <DSUViz
                      name={name}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      values={val.values as any[]}
                      lastWrite={val.lastWrite}
                    />
                  </div>
                );
              }
            }

            // User-confirmed DSU via ambiguity panel (name not in DSU_NAMES)
            if (!val.rows && !val.cols && vizHints[name]?.kind === 'dsu') {
              return (
                <div key={name} className="px-1.5 pb-1">
                  <DSUViz
                    name={name}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    values={val.values as any[]}
                    lastWrite={val.lastWrite}
                  />
                </div>
              );
            }

            // BIT/Fenwick array detection
            if (!val.rows && !val.cols && BIT_NAMES.has(name)) {
              return (
                <div key={name} className="px-1.5 pb-1">
                  <BITViz
                    name={name}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    values={val.values as any[]}
                    lastWrite={val.lastWrite}
                  />
                </div>
              );
            }

            const arrLen = !val.rows && !val.cols ? (val.values as number[]).length : 0;
            const pointers = !val.rows && !val.cols
              ? computePointers(frame, name, arrLen) : undefined;
            const win = !val.rows && !val.cols
              ? computeWindow(frame, arrLen) : null;

            return (
              <div key={name} className="px-1.5 pb-1">
                <ArrayViz
                  name={name}
                  values={val.values as number[] | number[][]}
                  rows={val.rows}
                  cols={val.cols}
                  // declared WRITE(cell) from the cause chain wins; fall back to
                  // the legacy lastWrite only when no cause declares the write
                  lastWrite={declaredWrites[name] ?? val.lastWrite}
                  pointers={pointers}
                  windowLeft={win?.left}
                  windowRight={win?.right}
                />
              </div>
            );
          }
          // String viz: char-kind with length > 1 renders as character boxes with index pointers
          if (val.kind === 'char' && val.value.length > 1) {
            const strLen = val.value.length;
            const pointers = computePointers(frame, name, strLen);
            const strWin   = computeWindow(frame, strLen);
            // Detect last-modified character index by diffing prev value
            let lastWrite: number | undefined;
            const prevVal = prevVars[name];
            if (prevVal?.kind === 'char' && prevVal.value !== val.value) {
              for (let ci = 0; ci < val.value.length; ci++) {
                if (val.value[ci] !== prevVal.value[ci]) { lastWrite = ci; break; }
              }
            }
            return (
              <div key={name} className="px-1.5 pb-1">
                <StringViz
                  name={name}
                  value={val.value}
                  lastWrite={lastWrite}
                  pointers={pointers}
                  windowLeft={strWin?.left}
                  windowRight={strWin?.right}
                />
              </div>
            );
          }

          return (
            <StackVariable
              // Row key is the name (unique within a frame): a reference makes
              // two names share ONE oid, so an oid row-key would collide. Morph
              // identity still flows through the oid inside StackVariable.
              key={name}
              frameName={frame.function}
              name={name}
              value={val}
              aliases={aliasesByName[name]}
              changed={hasChanged(name, val)}
            />
          );
          });
        })()}
      </div>
    </motion.div>
  );
}
