import { TraceStep } from '../types/trace';

// ── Data ─────────────────────────────────────────────────────────────

interface CallRecord {
  id: number;
  label: string;
  depth: number;
  returnVal?: string;
  isActive: boolean;  // still on the call stack
  isBase: boolean;    // returned without making sub-calls
}

function buildRecords(steps: TraceStep[], upTo: number): CallRecord[] {
  interface StackEntry { idx: number; subCalls: number }
  const records: CallRecord[] = [];
  const stack: StackEntry[] = [];
  let nextId = 0;

  for (let i = 0; i <= upTo && i < steps.length; i++) {
    const ev = steps[i].event;

    if (ev.type === 'call') {
      const args = ev.args ?? [];
      const fn = ev.function.startsWith('<lambda:')
        ? 'λ' + ev.function.slice(8, -1)
        : ev.function;
      records.push({
        id: nextId++,
        label: `${fn}(${args.join(', ')})`,
        depth: stack.length,
        isActive: true,
        isBase: false,
      });
      if (stack.length > 0) stack[stack.length - 1].subCalls++;
      stack.push({ idx: records.length - 1, subCalls: 0 });

    } else if (ev.type === 'return') {
      if (stack.length > 0) {
        const { idx, subCalls } = stack.pop()!;
        records[idx].returnVal = ev.value ?? '';
        records[idx].isActive  = false;
        records[idx].isBase    = subCalls === 0;
      }
    }
  }

  return records;
}

// ── Component ─────────────────────────────────────────────────────────

export default function CallTreePanel({
  steps,
  currentStep,
}: {
  steps: TraceStep[];
  currentStep: number;
}) {
  const records = buildRecords(steps, currentStep);

  // Only show when there is at least one user-function call
  const hasCalls = records.some(r => !r.label.startsWith('λ'));
  if (!hasCalls) return null;

  // Deepest still-active record = currently executing call
  const currentId = records.reduce<number | null>(
    (found, r) => (r.isActive ? r.id : found),
    null,
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 text-[10px] text-zinc-600 uppercase tracking-widest font-mono flex-shrink-0">
        Call Tree
      </div>

      <div className="px-2 pb-3 overflow-y-auto flex-1" style={{ minHeight: 0 }}>
        {records.map(rec => {
          const isCurrent = rec.id === currentId;
          const returned  = rec.returnVal !== undefined;

          return (
            <div
              key={rec.id}
              className="flex items-center min-w-0"
              style={{ paddingLeft: rec.depth * 12 }}
            >
              {/* Tree gutter */}
              {rec.depth > 0 && (
                <span className="text-zinc-700 text-[9px] mr-1 flex-shrink-0 select-none">└</span>
              )}

              {/* Call pill */}
              <div
                className={[
                  'flex items-center gap-1 my-[1px] px-1.5 py-[2px] rounded text-[9px] font-mono min-w-0 flex-1',
                  isCurrent
                    ? 'bg-amber-500/15 border border-amber-500/40 text-amber-200'
                    : rec.isActive
                      ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-300'
                      : 'text-zinc-500',
                ].join(' ')}
              >
                <span className="truncate flex-1">{rec.label}</span>

                {/* Return value */}
                {returned && (
                  <span
                    className={[
                      'flex-shrink-0 font-semibold',
                      rec.isBase ? 'text-green-500' : 'text-zinc-400',
                    ].join(' ')}
                  >
                    → {rec.returnVal}
                  </span>
                )}
              </div>

              {/* Base-case badge */}
              {rec.isBase && returned && (
                <span className="ml-1 flex-shrink-0 text-[7px] font-mono text-green-700 border border-green-900/60 rounded px-0.5 select-none">
                  base
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
