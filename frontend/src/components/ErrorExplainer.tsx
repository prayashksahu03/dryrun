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
  'uninit-var': {
    title: 'Uninitialized Variable Read',
    docCategory: 17,
    severity: 'warning',
    what: 'You read a local variable before assigning it a value. Its contents are garbage — whatever bytes happened to be on the stack.',
    fix: 'Always initialize variables at declaration: int x = 0; bool found = false; etc.',
    hint: 'Initialize every variable at declaration',
  },
  'bitmask-precedence': {
    title: 'Bitmask Operator Precedence',
    docCategory: 30,
    severity: 'warning',
    what: 'Bitwise &, |, ^ have lower precedence than == and != in C++. The expression a & b == 0 is parsed as a & (b == 0), not (a & b) == 0.',
    fix: 'Always parenthesize bitmask expressions: (n & mask) != 0, (x | flag) == y.',
    hint: 'Add parentheses around & | ^ operands',
  },
  'missing-return': {
    title: 'Missing Return Value',
    docCategory: 34,
    severity: 'warning',
    what: 'A non-void function reached the end without executing a return statement. In C++ this is undefined behavior — the caller receives a garbage value.',
    fix: 'Add a return statement at the end. For recursive functions check that all branches return a value (category 34 Wrong Recursion Return).',
    hint: 'Ensure every code path in a non-void function returns a value',
  },
  'modify-during-iter': {
    title: 'Modify Container During Iteration',
    docCategory: 15,
    severity: 'warning',
    what: 'The container was resized (element erased or added) while a range-for loop is iterating over it. This invalidates the internal iterator and causes undefined behavior.',
    fix: 'Collect elements to erase in a separate vector and erase after the loop. Or use index-based for loops when mutating.',
    hint: 'Never erase/push to a container inside a range-for over that container',
  },
  'wrong-binary-search': {
    title: 'Possible Wrong Binary Search Logic',
    docCategory: 11,
    severity: 'warning',
    what: 'A loop with lo/hi/mid ran many iterations without converging. Common mistakes: using mid = (lo+hi)/2 when lo=hi causes infinite loop, or wrong boundary update (lo=mid instead of lo=mid+1).',
    fix: 'Use lo = mid + 1 or hi = mid - 1 (not mid) to ensure the search space shrinks each step. Check that the loop terminates: while (lo < hi) or while (lo <= hi) depending on the template.',
    hint: 'Verify lo/hi updates shrink the search space each iteration',
  },
  'queue-duplicate': {
    title: 'Possible Missing Visited Array (BFS)',
    docCategory: 7,
    severity: 'warning',
    what: 'The same value has been pushed to a queue 3+ times. In BFS/graph traversal this usually means nodes are being re-enqueued without a visited[] or seen[] array, causing exponential work.',
    fix: 'Add visited[node] = true before or immediately after enqueuing. Check !visited[next] before push.',
    hint: 'Mark nodes visited before pushing to BFS queue',
  },
  'pq-order-mismatch': {
    title: 'Wrong Priority Queue Ordering',
    docCategory: 23,
    severity: 'warning',
    what: 'The priority queue variable name suggests min/max heap but the declared comparator does the opposite. This causes Dijkstra or greedy algorithms to pop the wrong element.',
    fix: 'For min-heap (Dijkstra): priority_queue<int,vector<int>,greater<int>>. For max-heap: default priority_queue<int>.',
    hint: 'Match greater<> comparator to intended min/max ordering',
  },
  'iterator-invalidation': {
    title: 'Iterator Invalidation',
    docCategory: 14,
    severity: 'warning',
    what: 'A push_back on a vector may reallocate its internal buffer, invalidating all existing iterators, pointers, and references to its elements.',
    fix: 'Avoid storing iterators across push_back calls. Use indices instead of iterators when modifying the vector.',
    hint: 'Do not use iterators after push_back — use indices instead',
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
  { num: 7,  name: 'Missing Visited Array',              detectable: true  },  // → queue-duplicate
  { num: 8,  name: 'Queue Underflow',                    detectable: true  },
  { num: 9,  name: 'Stack Underflow',                    detectable: true  },
  { num: 10, name: 'Integer Overflow',                   detectable: true  },
  { num: 11, name: 'Wrong Binary Search Logic',          detectable: true  },  // → wrong-binary-search
  { num: 12, name: 'Off By One Errors',                  detectable: true  },  // → out-of-bounds improved msg
  { num: 13, name: 'Wrong Prefix Sum Formula',           detectable: true  },  // → out-of-bounds / wrong assign
  { num: 14, name: 'Iterator Invalidation',              detectable: true  },  // → iterator-invalidation
  { num: 15, name: 'Modifying Container During Iteration', detectable: true  },  // → modify-during-iter
  { num: 16, name: 'Wrong Graph Indexing',               detectable: true  },  // → out-of-bounds improved msg
  { num: 17, name: 'Uninitialized Variables',            detectable: true  },  // → uninit-var
  { num: 18, name: 'Wrong DP Transition',                detectable: true  },  // → out-of-bounds / wrong assign
  { num: 19, name: 'Missing Base Case',                  detectable: true  },  // → stack-overflow
  { num: 20, name: 'Dangling Linked List Pointer',       detectable: true  },  // → use-after-free
  { num: 21, name: 'Wrong BFS Visited Timing',           detectable: true  },  // → queue-duplicate
  { num: 22, name: 'Incorrect Parent Tracking',          detectable: true  },  // → wrong assign event
  { num: 23, name: 'Wrong Priority Queue Ordering',      detectable: true  },  // → pq-order-mismatch
  { num: 24, name: 'Segmentation Fault',                 detectable: true  },
  { num: 25, name: 'Time Complexity Explosion',          detectable: true  },  // → infinite loop
  { num: 26, name: 'Memory Leaks',                       detectable: true  },
  { num: 27, name: 'Infinite Recursion in Graphs/Trees', detectable: true  },  // → stack-overflow
  { num: 28, name: 'Wrong Comparator Logic',             detectable: true  },  // → pq-order-mismatch / wrong sort
  { num: 29, name: 'Incorrect Sliding Window Shrink',    detectable: true  },  // → wrong-binary-search heuristic
  { num: 30, name: 'Bitmask Errors',                     detectable: true  },  // → bitmask-precedence
  { num: 31, name: 'Modulo Errors',                      detectable: true  },  // → int-overflow / division-by-zero
  { num: 32, name: 'Division By Zero',                   detectable: true  },
  { num: 33, name: 'Accessing Empty String',             detectable: true  },  // → out-of-bounds
  { num: 34, name: 'Wrong Recursion Return',             detectable: true  },  // → missing-return
  { num: 35, name: 'Mutating Shared Reference',          detectable: true  },  // → wrong assign / use-after-free
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
