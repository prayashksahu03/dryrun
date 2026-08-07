import { motion } from 'framer-motion';
import type { CauseOp } from '../types/trace';

// TRACE_CONTRACT_v2 walking-skeleton, slice 1.
// Renders the emitted causal chain 1:1 — zero inference, zero diffing.
// The frontend NEVER computes what happened; it only draws the ops the
// backend declared, in the order it declared them. That is the whole point
// of the slice: prove the trace model can drive the UI on its own.

function RefChip({ label, name, via, oid, value, accent }: {
  label: string; name?: string; via?: string; oid: string; value: number; accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">{label}</span>
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-xs ${
          accent
            ? 'bg-orange-500/15 border-orange-500/40 text-orange-300'
            : 'bg-zinc-800/70 border-zinc-700/70 text-zinc-200'
        }`}
      >
        {/* pointee writes read `*via` so users see the write lands via the pointer */}
        {via && <span className="text-sky-400">*{via}→</span>}
        <span>{name ?? '?'}</span>
        <span className="text-zinc-500">=</span>
        <span className={accent ? 'text-orange-200' : 'text-emerald-300'}>{value}</span>
      </div>
      {/* stable per-object identity — visible so users never have to infer it */}
      <span className="text-[8px] font-mono text-zinc-600">#{oid}</span>
    </div>
  );
}

function DerefChip({ ptr, target }: {
  ptr?: string; target?: { name?: string; oid: string };
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">deref</span>
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-sky-500/30 bg-sky-500/10 font-mono text-xs text-sky-200">
        <span>*{ptr}</span>
        <span className="text-zinc-500">→</span>
        <span className="text-zinc-100">{target?.name ?? '?'}</span>
      </div>
      <span className="text-[8px] font-mono text-zinc-600">#{target?.oid}</span>
    </div>
  );
}

function ComputeChip({ operator, operands, value }: {
  operator: string; operands: number[]; value: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">compute</span>
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-700/70 bg-zinc-800/70 font-mono text-xs text-zinc-200">
        <span className="text-violet-300">{operands.join(` ${operator} `)}</span>
        <span className="text-zinc-500">→</span>
        <span className="text-emerald-300">{value}</span>
      </div>
      <span className="text-[8px] font-mono text-transparent">.</span>
    </div>
  );
}

function Arrow({ i }: { i: number }) {
  return (
    <motion.span
      className="text-zinc-600 text-sm mt-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.12 * i + 0.06, duration: 0.15 }}
    >
      →
    </motion.span>
  );
}

export default function CauseRibbon({ cause }: { cause: CauseOp[] }) {
  return (
    <div className="flex-shrink-0 border-b border-zinc-800/80 bg-[#0b0b0e] px-4 py-2.5">
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">cause</span>
        <span className="text-[10px] font-mono text-zinc-600">— why this changed, step by step</span>
      </div>
      <div className="flex items-start gap-2 overflow-x-auto pb-1">
        {cause.map((op, i) => (
          <div key={i} className="flex items-start gap-2">
            {i > 0 && <Arrow i={i} />}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 * i, duration: 0.2, ease: 'easeOut' }}
            >
              {op.op === 'READ' && (
                <RefChip label="read" name={op.ref.name} oid={op.ref.oid} value={op.value} />
              )}
              {op.op === 'COMPUTE' && (
                <ComputeChip operator={op.operator} operands={op.operands} value={op.value} />
              )}
              {op.op === 'DEREF' && (
                <DerefChip ptr={op.ref.name} target={op.target} />
              )}
              {op.op === 'WRITE' && (
                <RefChip label="write" name={op.ref.name} via={op.ref.via} oid={op.ref.oid} value={op.value} accent />
              )}
            </motion.div>
          </div>
        ))}
      </div>
    </div>
  );
}
