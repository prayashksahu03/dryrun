import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { VariableValue } from '../../types/trace';
import { useRefRegistry } from '../../contexts/refRegistry';

function displayValue(v: VariableValue): string {
  if (v.kind === 'pointer') return v.address ?? 'NULL';
  if (v.kind === 'int')     return String(v.value);
  if (v.kind === 'float')   return String(v.value);
  if (v.kind === 'char')    return v.value.length === 1 ? `'${v.value}'` : `"${v.value}"`;
  if (v.kind === 'struct') {
    const { fields } = v;
    const entries = Object.entries(fields);
    // std::pair
    if ('first' in fields && 'second' in fields && entries.length === 2)
      return `(${displayValue(fields.first)}, ${displayValue(fields.second)})`;
    // General struct: show up to 3 fields as key:value
    const parts = entries
      .slice(0, 3)
      .map(([k, fv]) => `${k}:${displayValue(fv)}`);
    return `{${parts.join(', ')}${entries.length > 3 ? ', …' : ''}}`;
  }
  if (v.kind === 'array') return `[${v.values.length}]`;
  if (v.kind === 'array_ptr') {
    const inner = v.data;
    const len = inner && inner.kind === 'array' ? inner.values.length : '?';
    return `→[${len}]`;
  }
  if (v.kind === 'set' || v.kind === 'multiset') return `{${v.data.length}}`;
  if (v.kind === 'map')   return `{${Object.keys(v.data).length}}`;
  return '?';
}

export default function StackVariable({
  frameName, name, value, changed,
}: {
  frameName: string;
  name: string;
  value: VariableValue;
  changed?: boolean;
}) {
  const { register } = useRefRegistry();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    register(`stack:${frameName}:${name}`, ref.current);
    return () => register(`stack:${frameName}:${name}`, null);
  });

  const isPointer = value.kind === 'pointer';
  const isNull    = isPointer && (value as { kind: 'pointer'; address: string | null }).address === null;
  const displayed = displayValue(value);

  return (
    <motion.div
      ref={ref}
      key={changed ? `${name}-${displayed}` : name}
      initial={{ backgroundColor: changed ? 'rgba(245,158,11,0.12)' : 'rgba(0,0,0,0)' }}
      animate={{ backgroundColor: 'rgba(0,0,0,0)' }}
      transition={{ duration: 0.75 }}
      className="flex items-center justify-between px-2 py-0.5 rounded"
    >
      <span className="text-zinc-500 text-[11px] font-mono">{name}</span>
      <div className="flex items-center gap-1.5">
        {isPointer && (
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors duration-300"
            style={{ background: isNull ? '#4b5563' : '#22c55e' }}
          />
        )}
        <motion.span
          key={displayed}
          initial={{ color: '#f59e0b', scale: 1.05 }}
          animate={{
            color: isNull ? '#4b5563' : isPointer ? '#67e8f9' : '#fcd34d',
            scale: 1,
          }}
          transition={{ duration: 0.5 }}
          className="text-[11px] font-mono"
        >
          {displayed}
        </motion.span>
      </div>
    </motion.div>
  );
}
