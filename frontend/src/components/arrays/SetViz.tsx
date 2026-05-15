import { motion, AnimatePresence } from 'framer-motion';
import { SetEntry, VariableValue } from '../../types/trace';

function fmtVal(v: VariableValue | unknown): string {
  if (v === null || v === undefined) return '?';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'object') return String(v);
  const o = v as VariableValue;
  if (o.kind === 'int')    return String(o.value);
  if (o.kind === 'char')   return `'${o.value}'`;
  if (o.kind === 'pointer') return (o as { kind: 'pointer'; address: string | null }).address ?? 'NULL';
  if (o.kind === 'struct') {
    const f = o.fields as Record<string, VariableValue>;
    const first  = f.first  ? fmtVal(f.first)  : '';
    const second = f.second ? fmtVal(f.second) : '';
    return first && second ? `(${first},${second})` : '{…}';
  }
  return '?';
}

// ── Set visualization ─────────────────────────────────────────────────
// Displays a sorted set<T> as horizontally-wrapped chips in sorted order.

export function SetViz({ name, entries, label = 'set' }: { name: string; entries: SetEntry[]; label?: string }) {
  return (
    <div className="mt-1.5 mb-1 select-none">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-zinc-600">
          {name}
          <span className="text-zinc-700 ml-1">[{entries.length}]</span>
        </span>
        <span className="text-[8px] font-mono text-teal-400/50 border border-teal-500/20 px-1 rounded">
          {label}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="text-[10px] font-mono text-zinc-700 px-1">empty</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <AnimatePresence initial={false}>
            {entries.map((entry, i) => (
              <motion.div
                key={`${entry.key}-${i}`}
                initial={{ opacity: 0, scale: 0.75 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.75 }}
                transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                className="flex items-center justify-center font-mono text-[10px] font-semibold px-1.5"
                style={{
                  height: 24,
                  background: 'rgba(20,184,166,0.08)',
                  border: '1px solid rgba(20,184,166,0.28)',
                  borderRadius: 4,
                  color: '#2dd4bf',
                }}
              >
                {fmtVal(entry.val)}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ── Map visualization ──────────────────────────────────────────────────
// Displays a map<K,V> as key→value rows.

export function MapViz({ name, data }: { name: string; data: Record<string, VariableValue> }) {
  const entries = Object.entries(data);
  return (
    <div className="mt-1.5 mb-1 select-none">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-zinc-600">
          {name}
          <span className="text-zinc-700 ml-1">[{entries.length}]</span>
        </span>
        <span className="text-[8px] font-mono text-violet-400/50 border border-violet-500/20 px-1 rounded">
          map
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="text-[10px] font-mono text-zinc-700 px-1">empty</div>
      ) : (
        <div className="flex flex-col gap-px">
          <AnimatePresence initial={false}>
            {entries.map(([key, val]) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                className="flex items-center justify-between px-1.5 font-mono text-[10px]"
                style={{
                  height: 22,
                  background: 'rgba(139,92,246,0.06)',
                  border: '1px solid rgba(139,92,246,0.20)',
                  borderRadius: 4,
                }}
              >
                <span style={{ color: '#a78bfa' }}>{key}</span>
                <span style={{ color: '#c4b5fd' }}>{fmtVal(val)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
