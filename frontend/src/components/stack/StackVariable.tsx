import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { VariableValue } from '../../types/trace';
import { useRefRegistry } from '../../contexts/refRegistry';
import { getVisualIdentity } from '../../utils/visualIdentity';

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
  frameName, name, value, changed, aliases,
}: {
  frameName: string;
  name: string;
  value: VariableValue;
  changed?: boolean;
  aliases?: string[];   // other names bound to this same object (e.g. references)
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
      // Identity is the object's oid: the row persists across value changes and
      // morphs in place (it no longer remounts on every mutation). The amber
      // change-flash is driven by `animate` keyed on the value, not by remount.
      key={getVisualIdentity(value, name)}
      animate={{
        backgroundColor: changed
          ? ['rgba(245,158,11,0.12)', 'rgba(0,0,0,0)']
          : 'rgba(0,0,0,0)',
      }}
      transition={{ duration: 0.75 }}
      className="flex items-center justify-between px-2 py-0.5 rounded"
    >
      <span className="flex items-center gap-1">
        <span className="text-zinc-500 text-[11px] font-mono">{name}</span>
        {/* one box, two names: a reference is just another nameplate on the object */}
        {aliases?.map((a) => (
          <span
            key={a}
            title="reference — same object, another name"
            className="text-[9px] font-mono px-1 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/25"
          >
            &amp;{a}
          </span>
        ))}
      </span>
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
