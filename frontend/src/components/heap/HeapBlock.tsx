import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { HeapBlock, VariableValue } from '../../types/trace';
import { useRefRegistry } from '../../contexts/refRegistry';
import { useExecutionStore } from '../../store/executionStore';

function FieldDisplay({ value }: { value: VariableValue }) {
  if (value.kind === 'pointer') {
    return (
      <span className={value.address ? 'text-cyan-400' : 'text-zinc-600'}>
        {value.address ?? 'NULL'}
      </span>
    );
  }
  if (value.kind === 'int')   return <span className="text-amber-400">{value.value}</span>;
  if (value.kind === 'float') return <span className="text-amber-400">{value.value}</span>;
  if (value.kind === 'char')  return <span className="text-green-400">'{value.value}'</span>;
  if (value.kind === 'array') return <span className="text-zinc-400">[{value.values.length}]</span>;
  if (value.kind === 'struct') {
    const entries = Object.entries(value.fields).slice(0, 2);
    const parts = entries.map(([k, fv]) => {
      const v = fv.kind === 'int' || fv.kind === 'float' ? fv.value
              : fv.kind === 'char' ? `'${fv.value}'` : '…';
      return `${k}:${v}`;
    });
    return <span className="text-zinc-300">{`{${parts.join(', ')}}`}</span>;
  }
  return <span className="text-zinc-600">?</span>;
}

export default function HeapBlockComponent({
  address, block, isCrashTarget,
}: {
  address: string;
  block: HeapBlock;
  isCrashTarget: boolean;
}) {
  const { register } = useRefRegistry();
  const blockRef  = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Previous snapshot of this heap block for diff highlighting
  const prevBlock = useExecutionStore(s => s.prevFrame()?.memory.heap[address] ?? null);

  useEffect(() => {
    register(`heap:${address}`, blockRef.current);
    return () => register(`heap:${address}`, null);
  });

  useEffect(() => {
    Object.entries(fieldRefs.current).forEach(([field, el]) => {
      register(`heap:${address}:${field}`, el);
    });
    return () => {
      Object.keys(fieldRefs.current).forEach(f =>
        register(`heap:${address}:${f}`, null)
      );
    };
  });

  const isFreed = block.state === 'freed';

  // Which fields changed since the last step
  const changedFields = new Set<string>();
  if (prevBlock) {
    for (const [field, val] of Object.entries(block.fields)) {
      const prev = prevBlock.fields[field];
      if (!prev || JSON.stringify(prev) !== JSON.stringify(val)) {
        changedFields.add(field);
      }
    }
  }

  return (
    <motion.div
      ref={blockRef}
      initial={{ scale: 0.75, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: isFreed ? 0.55 : 1,
        x: isCrashTarget ? [0, -6, 6, -6, 6, -3, 3, 0] : 0,
      }}
      exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.25 } }}
      transition={{
        scale:   { type: 'spring', stiffness: 280, damping: 22 },
        opacity: { duration: 0.4 },
        x:       { duration: 0.45 },
      }}
      layout
      className="relative rounded font-mono text-xs overflow-hidden min-w-[148px]"
      style={{
        border: isCrashTarget
          ? '1px solid rgba(239,68,68,0.65)'
          : isFreed
            ? '1px dashed rgba(63,63,70,0.5)'
            : '1px solid rgba(34,197,94,0.28)',
        background: isCrashTarget
          ? 'rgba(239,68,68,0.07)'
          : isFreed
            ? 'rgba(12,12,14,0.92)'
            : 'rgba(10,24,13,0.92)',
        boxShadow: isCrashTarget
          ? '0 0 16px rgba(239,68,68,0.15)'
          : isFreed
            ? 'none'
            : '0 0 8px rgba(34,197,94,0.06)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-2.5 py-1 border-b"
        style={{
          borderColor: isCrashTarget ? 'rgba(239,68,68,0.3)' : isFreed ? 'rgba(63,63,70,0.3)' : 'rgba(34,197,94,0.15)',
          background:  isCrashTarget ? 'rgba(239,68,68,0.08)' : isFreed ? 'rgba(30,30,32,0.5)' : 'rgba(34,197,94,0.04)',
        }}
      >
        <span
          className="text-[10px] font-semibold"
          style={{ color: isCrashTarget ? '#f87171' : isFreed ? '#52525b' : '#4ade80' }}
        >
          {block.typeName}
        </span>
        <span className="text-[9px] text-zinc-600">{address}</span>
      </div>

      {/* Freed diagonal stripe overlay */}
      {isFreed && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(239,68,68,0.06) 0px, rgba(239,68,68,0.06) 1px, transparent 1px, transparent 9px)',
          }}
        />
      )}

      {/* Fields */}
      <div className="px-2.5 py-1.5 space-y-0.5">
        {Object.entries(block.fields).map(([fieldName, val]) => {
          const fieldChanged = changedFields.has(fieldName);
          return (
            <motion.div
              key={fieldName}
              ref={el => { fieldRefs.current[fieldName] = el; }}
              // Flash the row background when this field changed
              initial={{ backgroundColor: fieldChanged ? 'rgba(245,158,11,0.14)' : 'rgba(0,0,0,0)' }}
              animate={{ backgroundColor: 'rgba(0,0,0,0)' }}
              transition={{ duration: 0.8 }}
              className="flex items-center justify-between gap-3 rounded px-0.5"
            >
              <span className={`text-[10px] flex items-center gap-1 ${fieldChanged ? 'text-amber-400/70' : 'text-zinc-600'}`}>
                {fieldChanged && (
                  <motion.span
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.8 }}
                    className="text-[8px] text-amber-400"
                  >
                    ●
                  </motion.span>
                )}
                {fieldName}
              </span>
              <span className={`text-[10px] ${isFreed ? 'opacity-35' : ''}`}>
                <FieldDisplay value={val} />
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className="px-2.5 py-0.5 border-t text-[9px] text-zinc-700"
        style={{ borderColor: isFreed ? 'rgba(63,63,70,0.2)' : 'rgba(34,197,94,0.08)' }}
      >
        {block.size}B ·{' '}
        {isFreed
          ? <span className="text-red-500/60">freed @ line {block.freedAtLine}</span>
          : <span>alloc @ line {block.allocatedAtLine}</span>
        }
      </div>

      {/* FREED label centered */}
      {isFreed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <span className="text-[9px] font-bold text-red-500/50 tracking-[0.25em] uppercase">
            freed
          </span>
        </div>
      )}
    </motion.div>
  );
}
