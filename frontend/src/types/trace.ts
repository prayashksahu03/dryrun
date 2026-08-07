export type SetEntry = { key: string; val: VariableValue };

export type VariableValue =
  | { kind: 'int';      value: number }
  | { kind: 'float';    value: number }
  | { kind: 'char';     value: string }
  | { kind: 'pointer';  address: string | null }
  | { kind: 'struct';   fields: Record<string, VariableValue> }
  | { kind: 'array';    values: number[] | number[][] | VariableValue[]; rows?: number; cols?: number; lastWrite?: number[]; ctype?: string; min_heap?: boolean }
  | { kind: 'set';      data: SetEntry[] }
  | { kind: 'multiset'; data: SetEntry[] }
  | { kind: 'map';      data: Record<string, VariableValue> }
  | { kind: 'iterator'; data: SetEntry[]; idx: number | null }
  | { kind: 'array_ptr'; name: string; idx: number; data: VariableValue }
  | { kind: 'ref';       target: string };

export interface HeapBlock {
  address: string;
  size: number;
  typeName: string;
  state: 'allocated' | 'freed';
  fields: Record<string, VariableValue>;
  allocatedAtLine: number;
  freedAtLine?: number;
}

export interface StackFrameData {
  function: string;
  line: number;
  variables: Record<string, VariableValue>;
}

export interface MemorySnapshot {
  stack: StackFrameData[];
  heap: Record<string, HeapBlock>;
}

// TRACE_CONTRACT_v2 (slice 1): an ordered, self-describing causal chain.
// A reference descriptor names WHAT an op touches, with a stable per-object oid.
export type CauseRef = {
  kind: 'name' | 'cell' | 'pointee';
  name?: string; via?: string;
  oid?: string;            // present for name/pointee refs (the object's identity)
  container_oid?: string;  // present for cell refs (the containing object's identity)
  index?: number;          // present for cell refs
};
export type CauseOp =
  | { op: 'READ';    ref: CauseRef; value: number }
  | { op: 'COMPUTE'; operator: string; operands: number[]; value: number }
  | { op: 'DEREF';   ref: CauseRef; target?: { name?: string; oid: string } }
  | { op: 'INDEX';   ref: CauseRef; index: number; cell: CauseRef }
  | { op: 'WRITE';   ref: CauseRef; value: number };

export type StepEvent =
  | { type: 'start' }
  | { type: 'malloc';  address: string; size: number; typeName: string }
  | { type: 'free';    address: string }
  | { type: 'assign';  target: string; value: string; cause?: CauseOp[] }
  | { type: 'call';    function: string; args?: string[] }
  | { type: 'return';  function: string; value?: string }
  | { type: 'crash';   kind: CrashKind; address?: string; message: string }
  | { type: 'warning'; kind: WarningKind; message: string }
  | { type: 'end';     leaks: string[]; truncated?: boolean }
  | { type: 'output';  text: string };

export type CrashKind =
  | 'null-deref' | 'use-after-free' | 'double-free'
  | 'stack-overflow' | 'out-of-bounds' | 'segfault'
  | 'division-by-zero' | 'out_of_range' | 'invalid-argument' | 'assert';

export type WarningKind =
  | 'int-overflow'
  | 'uninit-var'
  | 'bitmask-precedence'
  | 'missing-return'
  | 'modify-during-iter'
  | 'wrong-binary-search'
  | 'queue-duplicate'
  | 'pq-order-mismatch'
  | 'iterator-invalidation';

export interface TraceStep {
  index: number;
  line: number;
  description: string;
  event: StepEvent;
  memory: MemorySnapshot;
}

export interface Trace {
  id: string;
  name: string;
  concept: string;
  source: string;
  steps: TraceStep[];
}
