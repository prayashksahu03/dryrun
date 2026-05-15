import { motion } from 'framer-motion';
import { StackFrameData, VariableValue } from '../../types/trace';
import { useExecutionStore } from '../../store/executionStore';
import StackVariable from './StackVariable';
import ArrayViz, { ArrayPointer } from '../arrays/ArrayViz';
import { StackViz, QueueViz } from '../arrays/StackQueueViz';
import { SetViz, MapViz } from '../arrays/SetViz';

// Variable names that represent array indices/pointers
const INDEX_NAMES = new Set([
  'i', 'j', 'k', 'l', 'r', 'p', 'q',
  'left', 'right', 'mid', 'lo', 'hi',
  'start', 'end', 'ptr', 'idx', 'pos',
  'slow', 'fast', 'head', 'tail', 'curr',
]);

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
        {Object.entries(frame.variables).map(([name, val]) => {
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
          if (val.kind === 'array') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ctype: string = (val as any).ctype ?? '';
            const isStack = ctype.includes('stack') && !ctype.includes('priority');
            const isQueue = ctype.includes('queue') || ctype.includes('deque');

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

            return (
              <div key={name} className="px-1.5 pb-1">
                <ArrayViz
                  name={name}
                  values={val.values as number[] | number[][]}
                  rows={val.rows}
                  cols={val.cols}
                  lastWrite={val.lastWrite}
                  pointers={
                    !val.rows && !val.cols
                      ? computePointers(frame, name, (val.values as number[]).length)
                      : undefined
                  }
                />
              </div>
            );
          }
          return (
            <StackVariable
              key={name}
              frameName={frame.function}
              name={name}
              value={val}
              changed={hasChanged(name, val)}
            />
          );
        })}
      </div>
    </motion.div>
  );
}
