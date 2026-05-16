import { motion, AnimatePresence } from 'framer-motion';
import { useExecutionStore } from '../store/executionStore';
import { CrashKind, WarningKind } from '../types/trace';

// ── Error/warning knowledge base ─────────────────────────────────────────────

interface ErrorInfo {
  title: string;
  docCategory: number;   // maps to the 35 categories in the checklist
  what: string;
  fix: string;
  hint: string;          // short one-liner shown in event log
  severity: 'crash' | 'warning';
}

const CRASH_INFO: Record<string, ErrorInfo> = {
  'null-deref': {
    title: 'Null Pointer Dereference',
    docCategory: 1,
    severity: 'crash',
    what: 'You accessed a member or called a method through a pointer that is nullptr. This is an immediate crash.',
    fix: 'Always null-check pointers before dereferencing. In linked list traversal, check node != nullptr before node->next.',
    hint: 'Check pointer != nullptr before dereferencing',
  },
  'use-after-free': {
    title: 'Use After Free',
    docCategory: 2,
    severity: 'crash',
    what: 'You read or wrote to heap memory after it was deleted. The memory now belongs to someone else — the data is garbage and the access is illegal.',
    fix: 'Set the pointer to nullptr immediately after delete. Never store raw pointers across function boundaries without ownership clarity.',
    hint: 'Set ptr = nullptr after delete',
  },
  'double-free': {
    title: 'Double Free',
    docCategory: 3,
    severity: 'crash',
    what: 'You called delete on the same memory address twice. The second delete corrupts the heap allocator.',
    fix: 'Set pointer to nullptr after the first delete so the second delete is a no-op. Prefer smart pointers (unique_ptr).',
    hint: 'Set ptr = nullptr after delete to prevent double-free',
  },
  'out-of-bounds': {
    title: 'Array / Vector Out Of Bounds',
    docCategory: 4,
    severity: 'crash',
    what: 'You accessed index i but the valid range is [0, size). This reads/writes garbage memory and may corrupt the stack.',
    fix: 'Add a bounds check: assert(0 <= i && i < n). Use .at() instead of [] on vectors for automatic bounds checking.',
    hint: 'Ensure 0 ≤ index < size before every array access',
  },
  'stack-overflow': {
    title: 'Stack Overflow / Infinite Recursion',
    docCategory: 6,
    severity: 'crash',
    what: 'The call stack exceeded its depth limit. Common causes: missing base case (category 19), or infinite recursion in a graph without a visited array (category 7 & 27).',
    fix: 'Add or fix the base case. For graph problems, mark nodes visited before recursing. Consider converting deep recursion to iterative with an explicit stack.',
    hint: 'Add a base case or visited[] check to stop recursion',
  },
  'division-by-zero': {
    title: 'Division / Modulo By Zero',
    docCategory: 32,
    severity: 'crash',
    what: 'The right-hand side of / or % evaluated to zero. In C++ this is undefined behavior and causes a hardware exception.',
    fix: 'Guard every division: if (b != 0) result = a / b. For modulo in hash functions, ensure the modulus is positive.',
    hint: 'Check divisor != 0 before dividing',
  },
  'out_of_range': {
    title: 'Queue / Stack Underflow',
    docCategory: 8,
    severity: 'crash',
    what: 'You called front(), top(), or pop() on an empty container. STL throws std::out_of_range and your program crashes.',
    fix: 'Always check !q.empty() before accessing the front/top. In BFS/DFS, confirm the queue is non-empty before each iteration.',
    hint: 'Check !container.empty() before pop()/top()/front()',
  },
  'invalid-argument': {
    title: 'Invalid Argument',
    docCategory: 28,
    severity: 'crash',
    what: 'A standard library function received input it cannot handle — e.g., stoi("abc") or stof("") crash with std::invalid_argument.',
    fix: 'Validate string contents before conversion. Use try/catch around stoi/stod or check isdigit/isalpha first.',
    hint: 'Validate input before calling stoi/stof/stol',
  },
  'segfault': {
    title: 'Segmentation Fault',
    docCategory: 24,
    severity: 'crash',
    what: 'Your program accessed a memory address it does not own. Typical causes: null pointer deref, wild pointer, or stack corruption from out-of-bounds write.',
    fix: 'Run with AddressSanitizer (compile with -fsanitize=address) to pinpoint the exact bad access.',
    hint: 'Check all pointer dereferences and array bounds',
  },
  'assert': {
    title: 'Assertion Failed',
    docCategory: 12,
    severity: 'crash',
    what: 'An assert() condition evaluated to false. This indicates an off-by-one error, wrong invariant, or incorrect assumption about the data.',
    fix: 'Read the assert condition carefully — it tells you exactly what invariant was violated.',
    hint: 'The assert condition was false — check surrounding logic',
  },
};

const WARNING_INFO: Record<string, ErrorInfo> = {
  'int-overflow': {
    title: 'Integer Overflow',
    docCategory: 10,
    severity: 'warning',
    what: 'An arithmetic result exceeded the 32-bit signed int range (±2,147,483,647). In C++ this is undefined behavior; the value has been wrapped to simulate typical hardware behavior.',
    fix: 'Use long long for intermediate products: (long long)a * b. Apply modulo early in modular arithmetic problems.',
    hint: 'Use long long or apply modulo to prevent overflow',
  },
};

// Descriptions for algorithmic errors (shown as doc-only reference, not auto-triggered)
export const ALL_35_CATEGORIES: Array<{ num: number; name: string; detectable: boolean }> = [
  { num: 1,  name: 'Null Pointer Dereference',          detectable: true  },
  { num: 2,  name: 'Use After Free',                     detectable: true  },
  { num: 3,  name: 'Double Free',                        detectable: true  },
  { num: 4,  name: 'Array Out Of Bounds',                detectable: true  },
  { num: 5,  name: 'Infinite Loop',                      detectable: true  },
  { num: 6,  name: 'Stack Overflow',                     detectable: true  },
  { num: 7,  name: 'Missing Visited Array',              detectable: false },
  { num: 8,  name: 'Queue Underflow',                    detectable: true  },
  { num: 9,  name: 'Stack Underflow',                    detectable: true  },
  { num: 10, name: 'Integer Overflow',                   detectable: true  },
  { num: 11, name: 'Wrong Binary Search Logic',          detectable: false },
  { num: 12, name: 'Off By One Errors',                  detectable: false },
  { num: 13, name: 'Wrong Prefix Sum Formula',           detectable: false },
  { num: 14, name: 'Iterator Invalidation',              detectable: false },
  { num: 15, name: 'Modifying Container During Iteration', detectable: false },
  { num: 16, name: 'Wrong Graph Indexing',               detectable: false },
  { num: 17, name: 'Uninitialized Variables',            detectable: false },
  { num: 18, name: 'Wrong DP Transition',                detectable: false },
  { num: 19, name: 'Missing Base Case',                  detectable: true  },  // → stack-overflow
  { num: 20, name: 'Dangling Linked List Pointer',       detectable: true  },  // → use-after-free
  { num: 21, name: 'Wrong BFS Visited Timing',           detectable: false },
  { num: 22, name: 'Incorrect Parent Tracking',          detectable: false },
  { num: 23, name: 'Wrong Priority Queue Ordering',      detectable: false },
  { num: 24, name: 'Segmentation Fault',                 detectable: true  },
  { num: 25, name: 'Time Complexity Explosion',          detectable: true  },  // → infinite loop
  { num: 26, name: 'Memory Leaks',                       detectable: true  },
  { num: 27, name: 'Infinite Recursion in Graphs/Trees', detectable: true  },  // → stack-overflow
  { num: 28, name: 'Wrong Comparator Logic',             detectable: false },
  { num: 29, name: 'Incorrect Sliding Window Shrink',    detectable: false },
  { num: 30, name: 'Bitmask Errors',                     detectable: false },
  { num: 31, name: 'Modulo Errors',                      detectable: false },
  { num: 32, name: 'Division By Zero',                   detectable: true  },
  { num: 33, name: 'Accessing Empty String',             detectable: true  },  // → out-of-bounds
  { num: 34, name: 'Wrong Recursion Return',             detectable: false },
  { num: 35, name: 'Mutating Shared Reference',          detectable: false },
];

// ── Component ─────────────────────────────────────────────────────────────

export default function ErrorExplainer() {
  const { currentFrame } = useExecutionStore();
  const frame = currentFrame();
  if (!frame) return null;

  const ev = frame.event;
  let info: ErrorInfo | null = null;
  let isInfiniteLoop = false;

  if (ev.type === 'crash') {
    info = CRASH_INFO[(ev as { type: 'crash'; kind: CrashKind }).kind] ?? null;
  } else if (ev.type === 'warning') {
    info = WARNING_INFO[(ev as { type: 'warning'; kind: WarningKind }).kind] ?? null;
  } else if (ev.type === 'end' && (ev as { type: 'end'; truncated?: boolean }).truncated) {
    isInfiniteLoop = true;
  }

  const visible = info !== null || isInfiniteLoop;

  const isCrash   = info?.severity === 'crash';
  const isWarning = info?.severity === 'warning';

  const borderColor = isCrash
    ? 'rgba(239,68,68,0.35)'
    : isWarning
      ? 'rgba(251,191,36,0.35)'
      : 'rgba(99,102,241,0.35)';
  const bgColor = isCrash
    ? 'rgba(239,68,68,0.06)'
    : isWarning
      ? 'rgba(251,191,36,0.06)'
      : 'rgba(99,102,241,0.06)';
  const accentColor = isCrash ? '#f87171' : isWarning ? '#fbbf24' : '#a5b4fc';
  const badgeBg = isCrash
    ? 'rgba(239,68,68,0.15)'
    : isWarning
      ? 'rgba(251,191,36,0.12)'
      : 'rgba(99,102,241,0.15)';

  const title   = isInfiniteLoop ? 'Infinite Loop / Trace Limit' : info!.title;
  const catNum  = isInfiniteLoop ? 5 : info!.docCategory;
  const what    = isInfiniteLoop
    ? 'The trace was cut off because a loop or recursion ran more steps than the limit. Likely causes: wrong loop condition, missing base case (category 19), or missing visited array in graph traversal (category 7).'
    : info!.what;
  const fix     = isInfiniteLoop
    ? 'Double-check loop termination conditions, ensure base cases are correct, and add a visited[] array for graph DFS/BFS.'
    : info!.fix;
  const hint    = isInfiniteLoop
    ? 'Check loop condition and recursion base case'
    : info!.hint;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="error-explainer"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          className="flex-shrink-0 mx-1.5 mb-1.5 rounded-lg overflow-hidden"
          style={{ border: `1px solid ${borderColor}`, background: bgColor }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: `1px solid ${borderColor}` }}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                style={{ background: badgeBg, color: accentColor }}
              >
                {isCrash ? '✕ CRASH' : isWarning ? '⚠ WARNING' : '⚠ LOOP'}
              </span>
              <span className="text-[11px] font-mono font-semibold" style={{ color: accentColor }}>
                {title}
              </span>
            </div>
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(113,113,122,0.7)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              #{catNum}/35
            </span>
          </div>

          {/* Body */}
          <div className="px-3 py-2.5 space-y-2">
            {/* What happened */}
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: 'rgba(113,113,122,0.7)' }}>what happened</p>
              <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'rgba(212,212,216,0.85)' }}>{what}</p>
            </div>
            {/* Fix */}
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: 'rgba(113,113,122,0.7)' }}>how to fix</p>
              <p className="text-[10px] font-mono leading-relaxed" style={{ color: accentColor }}>{fix}</p>
            </div>
          </div>

          {/* Footer hint */}
          <div
            className="px-3 py-1.5"
            style={{ borderTop: `1px solid ${borderColor}`, background: 'rgba(0,0,0,0.2)' }}
          >
            <p className="text-[9px] font-mono" style={{ color: 'rgba(113,113,122,0.6)' }}>
              tip: {hint}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
