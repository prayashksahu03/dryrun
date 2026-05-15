import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useExecutionStore } from '../store/executionStore';
import { Ambiguity, VizHint } from '../types/ambiguity';

// ── Individual option pill ────────────────────────────────────────────────
function OptionPill({
  label,
  sub,
  selected,
  onClick,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-lg text-left transition-all duration-150"
      style={{
        background: selected ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)',
        border: selected ? '1px solid rgba(99,102,241,0.55)' : '1px solid rgba(255,255,255,0.07)',
        cursor: 'pointer',
      }}
    >
      <span className="text-[11px] font-mono font-semibold w-full text-center"
        style={{ color: selected ? 'rgba(165,180,252,1)' : 'rgba(161,161,170,0.7)' }}>
        {label}
      </span>
      {sub && (
        <span className="text-[9px] font-mono w-full text-center"
          style={{ color: selected ? 'rgba(165,180,252,0.6)' : 'rgba(113,113,122,0.8)' }}>
          {sub}
        </span>
      )}
    </button>
  );
}

// ── Array unknown card (needs its own state for free-text input) ──────────
function ArrayUnknownCard({
  ambiguity, hint, onChange,
}: {
  ambiguity: Ambiguity;
  hint: VizHint | null;
  onChange: (h: VizHint) => void;
}) {
  const [freeText, setFreeText] = useState('');
  const [freeError, setFreeError] = useState('');
  const inferredN = ambiguity.arraySize ? Math.round(ambiguity.arraySize / 4) : '?';

  const applyFreeText = (raw: string) => {
    const t = raw.toLowerCase().trim();
    if (!t) { setFreeError(''); return; }
    if (t.includes('segtree') || t.includes('seg tree') || t.includes('segment tree')) {
      onChange({ kind: 'segtree_flat', indexBase: t.includes('0') ? 0 : 1 });
      setFreeError('');
    } else if (t === 'plain' || t === 'array' || t === 'plain array') {
      onChange({ kind: 'plain_array' });
      setFreeError('');
    } else {
      setFreeError(`Unknown. Try: "segment tree", "segment tree 0-indexed", or "plain array".`);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <code className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(99,102,241,0.12)', color: 'rgba(165,180,252,0.9)', border: '1px solid rgba(99,102,241,0.2)' }}>
          {ambiguity.varName}
        </code>
        <span className="text-zinc-600 text-[9px] font-mono">1D array · {ambiguity.arraySize} elements</span>
      </div>
      <p className="text-zinc-400 text-[10px]">What is this array used for?</p>

      <div className="flex gap-2">
        <OptionPill
          label="Seg Tree (1-idx)"
          sub={`n ≈ ${inferredN}, root[1]`}
          selected={hint?.kind === 'segtree_flat' && hint.indexBase === 1}
          onClick={() => onChange({ kind: 'segtree_flat', indexBase: 1 })}
        />
        <OptionPill
          label="Seg Tree (0-idx)"
          sub={`n ≈ ${inferredN}, root[0]`}
          selected={hint?.kind === 'segtree_flat' && hint.indexBase === 0}
          onClick={() => onChange({ kind: 'segtree_flat', indexBase: 0 })}
        />
        <OptionPill
          label="Plain Array"
          sub="keep as-is"
          selected={hint?.kind === 'plain_array'}
          onClick={() => onChange({ kind: 'plain_array' })}
        />
      </div>

      <div className="pt-1 space-y-1.5">
        <p className="text-zinc-600 text-[9px] font-mono">or describe it:</p>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={freeText}
            onChange={e => { setFreeText(e.target.value); setFreeError(''); }}
            onKeyDown={e => e.key === 'Enter' && applyFreeText(freeText)}
            placeholder="e.g. segment tree 0-indexed"
            className="flex-1 px-2 py-1.5 rounded text-[10px] font-mono outline-none"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: freeError ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.09)',
              color: 'rgba(212,212,216,0.9)',
            }}
          />
          <button
            onClick={() => applyFreeText(freeText)}
            className="px-2.5 py-1.5 rounded text-[10px] font-mono transition-all"
            style={{
              background: 'rgba(99,102,241,0.18)',
              border: '1px solid rgba(99,102,241,0.35)',
              color: 'rgba(165,180,252,0.9)',
            }}
          >
            Apply
          </button>
        </div>
        {freeError && (
          <p className="text-[9px] font-mono" style={{ color: 'rgba(239,68,68,0.75)' }}>{freeError}</p>
        )}
        {hint?.kind === 'segtree_flat' && (
          <p className="text-[9px] font-mono" style={{ color: 'rgba(129,140,248,0.6)' }}>
            ✓ Segment tree ({hint.indexBase}-indexed, n ≈ {inferredN})
          </p>
        )}
      </div>
    </div>
  );
}

// ── Card for each ambiguity ───────────────────────────────────────────────
function AmbiguityCard({
  ambiguity,
  hint,
  onChange,
}: {
  ambiguity: Ambiguity;
  hint: VizHint | null;
  onChange: (h: VizHint) => void;
}) {
  // ── matrix_or_graph ──
  if (ambiguity.kind === 'matrix_or_graph') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(99,102,241,0.12)', color: 'rgba(165,180,252,0.9)', border: '1px solid rgba(99,102,241,0.2)' }}>
            {ambiguity.varName}
          </code>
          <span className="text-zinc-600 text-[9px] font-mono">{ambiguity.matrixSize}×{ambiguity.matrixSize} matrix</span>
        </div>
        <p className="text-zinc-400 text-[10px]">How should this be visualized?</p>
        <div className="flex gap-2">
          <OptionPill
            label="Graph"
            sub="nodes + edges"
            selected={hint?.kind === 'graph'}
            onClick={() => onChange({ kind: 'graph' })}
          />
          <OptionPill
            label="2D Grid"
            sub="plain table"
            selected={hint?.kind === 'grid'}
            onClick={() => onChange({ kind: 'grid' })}
          />
        </div>
      </div>
    );
  }

  // ── struct_or_segtree ──
  if (ambiguity.kind === 'struct_or_segtree') {
    const fields = ambiguity.arrayFields ?? [];
    const segtreeHint = hint?.kind === 'segtree' ? hint : null;
    const selectedField = segtreeHint?.arrayField ?? fields[0] ?? '';
    const selectedBase  = segtreeHint?.indexBase ?? 1;

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(99,102,241,0.12)', color: 'rgba(165,180,252,0.9)', border: '1px solid rgba(99,102,241,0.2)' }}>
            {ambiguity.varName}
          </code>
          <span className="text-zinc-600 text-[9px] font-mono">struct</span>
        </div>
        <p className="text-zinc-400 text-[10px]">What is this data structure?</p>
        <div className="flex gap-2">
          <OptionPill
            label="Segment Tree"
            sub="binary tree viz"
            selected={hint?.kind === 'segtree'}
            onClick={() => onChange({ kind: 'segtree', arrayField: selectedField, indexBase: selectedBase })}
          />
          <OptionPill
            label="Regular Struct"
            sub="show inline"
            selected={hint?.kind === 'struct'}
            onClick={() => onChange({ kind: 'struct' })}
          />
        </div>

        {/* Sub-options shown only when "Segment Tree" is selected */}
        {hint?.kind === 'segtree' && (
          <div className="pt-1 space-y-2 border-t" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
            {/* Tree array field (if multiple) */}
            {fields.length > 1 && (
              <div className="space-y-1">
                <p className="text-zinc-500 text-[9px] font-mono">Tree array field</p>
                <div className="flex gap-1.5 flex-wrap">
                  {fields.map(f => (
                    <button
                      key={f}
                      onClick={() => onChange({ kind: 'segtree', arrayField: f, indexBase: selectedBase })}
                      className="px-2 py-0.5 rounded text-[9px] font-mono transition-all"
                      style={{
                        background: selectedField === f ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                        border: selectedField === f ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)',
                        color: selectedField === f ? 'rgba(165,180,252,0.9)' : 'rgba(113,113,122,0.8)',
                      }}
                    >
                      .{f}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Index base */}
            <div className="space-y-1">
              <p className="text-zinc-500 text-[9px] font-mono">Index convention</p>
              <div className="flex gap-2">
                <OptionPill
                  label="1-indexed"
                  sub="root at [1]"
                  selected={selectedBase === 1}
                  onClick={() => onChange({ kind: 'segtree', arrayField: selectedField, indexBase: 1 })}
                />
                <OptionPill
                  label="0-indexed"
                  sub="root at [0]"
                  selected={selectedBase === 0}
                  onClick={() => onChange({ kind: 'segtree', arrayField: selectedField, indexBase: 0 })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (ambiguity.kind === 'array_unknown') {
    return <ArrayUnknownCard ambiguity={ambiguity} hint={hint} onChange={onChange} />;
  }

  // ── pair_field_order ──
  if (ambiguity.kind === 'pair_field_order') {
    const [sf, ss] = ambiguity.samplePair ?? [0, 0];
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(99,102,241,0.12)', color: 'rgba(165,180,252,0.9)', border: '1px solid rgba(99,102,241,0.2)' }}>
            {ambiguity.varName}
          </code>
          <span className="text-zinc-600 text-[9px] font-mono">weighted adj list</span>
        </div>
        <p className="text-zinc-400 text-[10px]">
          In each pair <code className="text-indigo-300/70">{`{${sf}, ${ss}}`}</code>, which field is the neighbor?
        </p>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => onChange({ kind: 'pair_order', destField: 'first' })}
            className="px-3 py-2 rounded-lg text-left transition-all"
            style={{
              background: hint?.kind === 'pair_order' && hint.destField === 'first' ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)',
              border: hint?.kind === 'pair_order' && hint.destField === 'first' ? '1px solid rgba(99,102,241,0.55)' : '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <span className="text-[10px] font-mono"
              style={{ color: hint?.kind === 'pair_order' && hint.destField === 'first' ? 'rgba(165,180,252,1)' : 'rgba(161,161,170,0.7)' }}>
              <code className="text-indigo-300/80">.first</code> = neighbor node&nbsp;&nbsp;
              <code className="text-amber-400/60">.second</code> = weight
            </span>
            <span className="text-[9px] font-mono ml-2 text-zinc-600">→ node {sf}, weight {ss}</span>
          </button>
          <button
            onClick={() => onChange({ kind: 'pair_order', destField: 'second' })}
            className="px-3 py-2 rounded-lg text-left transition-all"
            style={{
              background: hint?.kind === 'pair_order' && hint.destField === 'second' ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)',
              border: hint?.kind === 'pair_order' && hint.destField === 'second' ? '1px solid rgba(99,102,241,0.55)' : '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <span className="text-[10px] font-mono"
              style={{ color: hint?.kind === 'pair_order' && hint.destField === 'second' ? 'rgba(165,180,252,1)' : 'rgba(161,161,170,0.7)' }}>
              <code className="text-amber-400/60">.first</code> = weight&nbsp;&nbsp;
              <code className="text-indigo-300/80">.second</code> = neighbor node
            </span>
            <span className="text-[9px] font-mono ml-2 text-zinc-600">→ weight {sf}, node {ss}</span>
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ── Main panel ────────────────────────────────────────────────────────────
export default function AmbiguityPanel() {
  const { ambiguities, vizHints, setVizHints } = useExecutionStore();

  // Track dismissal per ambiguity batch — resets when ambiguities change
  const [dismissed, setDismissed] = useState(false);
  const [selections, setSelections] = useState<Record<string, VizHint>>({});

  // Reset when a new batch of ambiguities arrives
  useEffect(() => {
    setDismissed(false);
    setSelections({});
  }, [ambiguities]);

  // Dialog is already resolved if vizHints covers all ambiguities
  const allResolved = ambiguities.length > 0 &&
    ambiguities.every(a => vizHints[a.varName] && vizHints[a.varName].kind !== 'skip');

  const visible = ambiguities.length > 0 && !dismissed && !allResolved;

  const handleConfirm = () => {
    // For any ambiguity not explicitly selected, use 'auto' (skip hint = auto-detect)
    const full: Record<string, VizHint> = {};
    for (const a of ambiguities) {
      full[a.varName] = selections[a.varName] ?? { kind: 'skip' };
    }
    setVizHints(full);
    setDismissed(true);
  };

  const handleSkip = () => {
    const full: Record<string, VizHint> = {};
    for (const a of ambiguities) full[a.varName] = { kind: 'skip' };
    setVizHints(full);
    setDismissed(true);
  };

  const setSelection = (varName: string, hint: VizHint) => {
    setSelections(prev => ({ ...prev, [varName]: hint }));
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          className="fixed z-50 flex flex-col"
          style={{
            bottom: 56,   // above timeline bar
            right: 16,
            width: 320,
            maxHeight: 'calc(100vh - 120px)',
            background: 'rgba(10, 10, 18, 0.94)',
            border: '1px solid rgba(99,102,241,0.28)',
            borderRadius: 12,
            boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.08)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-4 pt-4 pb-3"
            style={{ borderBottom: '1px solid rgba(99,102,241,0.12)' }}>
            <div>
              <p className="text-[12px] font-semibold text-zinc-100 leading-tight">
                Clarify your data structures
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5">
                {ambiguities.length === 1
                  ? 'We found 1 ambiguous variable.'
                  : `We found ${ambiguities.length} ambiguous variables.`}
              </p>
            </div>
            <button
              onClick={handleSkip}
              className="text-zinc-600 hover:text-zinc-400 transition-colors ml-2 mt-0.5"
              title="Skip — use auto-detection"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Ambiguity cards */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(99,102,241,0.2) transparent' }}>
            {ambiguities.map((a, i) => (
              <div key={a.id}>
                {i > 0 && <div className="border-t mb-4" style={{ borderColor: 'rgba(99,102,241,0.08)' }} />}
                <AmbiguityCard
                  ambiguity={a}
                  hint={selections[a.varName] ?? null}
                  onChange={h => setSelection(a.varName, h)}
                />
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 flex gap-2"
            style={{ borderTop: '1px solid rgba(99,102,241,0.12)' }}>
            <button
              onClick={handleConfirm}
              className="flex-1 py-2 rounded-lg text-[11px] font-mono font-semibold transition-all"
              style={{
                background: 'rgba(99,102,241,0.25)',
                border: '1px solid rgba(99,102,241,0.45)',
                color: 'rgba(165,180,252,1)',
              }}
            >
              Confirm
            </button>
            <button
              onClick={handleSkip}
              className="px-4 py-2 rounded-lg text-[11px] font-mono transition-all"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: 'rgba(113,113,122,0.8)',
              }}
            >
              Skip
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
