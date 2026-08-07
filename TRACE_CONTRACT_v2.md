# TRACE_CONTRACT_v2 (in progress)

*The execution-trace contract for DryRun, **derived from working code**, not speculation.*

> **Methodology (locked):** a field enters this contract **only after one implemented interaction proves it is required.** Everything below is either *proven* by a shipped walking-skeleton slice, *predicted* (named but not yet forced), or *open*. Nothing here is speculative design.

This document supersedes the ad-hoc v1 trace for the parts it covers. It does **not** yet redefine the whole trace — only the **cause chain** on assignment steps, which is what slices 1–3 exercised. The rest of the v1 `TraceStep` shape (`index`, `line`, `description`, `event`, `memory`) is unchanged.

---

## Constitutional invariants (proven, locked)

These are not serialization details; they are the rules every future addition must obey. When they conflict with convenience, they win.

- **I1 — Identity.** *Identity is created exactly once, at object birth, and belongs to the runtime object. Names, pointers, and references bind to that identity; they never create it.*
  - Heap objects mint their `oid` at allocation (`new`). Stack objects mint theirs at declaration. A pointer's target resolves to the **object's own** `oid`, never to a name.
  - **Proven by Slice 3:** a nameless heap object acquired an `oid` at `new`, was mutated through a pointer, and kept that identity throughout — falsifying "identity by name."

- **I2 — Every WRITE targets a reference.** *A mutation always names an addressable target via a reference descriptor.* There is no "write to a bare name" special case; a name is just one `kind` of reference.
  - **Proven by Slice 1:** even the trivial `x = y + 1` emits `WRITE(ref = name:x)`.

- **I3 — Values are materialized only when identity is required.** *A value rides on the operation that produced it; it becomes a standalone node only when it needs its own identity (an unnamed temporary, or a value shared across operations).*
  - **Proven by Slices 1–3:** `value` on `READ`/`COMPUTE`/`WRITE` was sufficient every time; no standalone `VALUE` node was ever needed for these shapes.

---

## The cause chain (proven shape)

An `assign` event MAY carry `cause`: an **ordered, self-describing** list of operations. The frontend renders it **1:1 with zero inference** — no diffing, no heuristics.

```
event.cause: CauseOp[]
```

### Reference descriptor (`REF`) — proven fields
```
REF = {
  kind: 'name' | 'cell' | 'pointee',   // 'cell' predicted, not yet proven
  oid:  string,                        // the target object's identity (I1)
  name?: string,                       // present for named lvalues; null for nameless (e.g. heap)
  via?:  string,                       // for 'pointee': the pointer the write went through
}
```

### Operation vocabulary — proven by slices 1–3
| op | fields | introduced by |
|----|--------|---------------|
| `READ`    | `ref: REF`, `value` | Slice 1 |
| `COMPUTE` | `operator`, `operands[]`, `value` | Slice 1 |
| `WRITE`   | `ref: REF`, `value` | Slice 1 |
| `DEREF`   | `ref: REF` (the pointer), `target: {name?, oid}` | Slice 2 |

### Worked examples (actual emitted output)

**Slice 1 — `x = y + 1`** (stack scalars):
```json
[ {"op":"READ","ref":{"kind":"name","name":"y","oid":"o1"},"value":7},
  {"op":"COMPUTE","operator":"+","operands":[7,1],"value":8},
  {"op":"WRITE","ref":{"kind":"name","name":"x","oid":"o2"},"value":8} ]
```

**Slice 2 — `*p = y + 1`** (`p` → named stack `x`):
```json
[ {"op":"READ","ref":{"kind":"name","name":"y","oid":"o1"},"value":7},
  {"op":"COMPUTE","operator":"+","operands":[7,1],"value":8},
  {"op":"DEREF","ref":{"kind":"name","name":"p","oid":"o3"},"target":{"name":"x","oid":"o2"}},
  {"op":"WRITE","ref":{"kind":"pointee","name":"x","via":"p","oid":"o2"},"value":8} ]
```

**Slice 3 — `*p = y + 1`** (`p` → heap `new int`, **no name**):
```json
[ {"op":"READ","ref":{"kind":"name","name":"y","oid":"o3"},"value":7},
  {"op":"COMPUTE","operator":"+","operands":[7,1],"value":8},
  {"op":"DEREF","ref":{"kind":"name","name":"p","oid":"o2"},"target":{"name":null,"oid":"o1"}},
  {"op":"WRITE","ref":{"kind":"pointee","name":null,"via":"p","oid":"o1"},"value":8} ]
```
The heap object's `oid` (`o1`) is minted at `new` (birth) and appears on the DEREF target and the WRITE — identity lives on the object, not the name.

---

## Predicted (named, not yet forced)

Do **not** add these until a slice proves them:
- `INDEX` op + `kind:'cell'` REF `{container_oid, index}` — expected from `parent[u] = v`.
- `ALLOC` / `REALLOC` ops carrying `old_storage_oid → new_storage_oid` — expected from `v.push_back(x)` (container growth).
- Standalone `VALUE` node — expected only when a temporary or shared subexpression appears (`f(g())`, `(a+b)*(a+b)`).

## Open
- **Full object-owned stack identity under aliasing.** Stack scalars currently mint their `oid` at declaration (birth timing is correct, I1 satisfied), but the `oid` is still keyed by name in the interpreter. This is observationally identical for named locals; it will need to move fully onto the object once **references/aliasing** (`int& r = x`) enter, since then a name must *bind to* an existing identity rather than key it. Deferred to the reference slice.

---

## Evidence (this contract was earned, not designed)

Walking-skeleton slices, each committed and verified 1:1 on screen:

| Slice | Program | Commit | Proved |
|-------|---------|--------|--------|
| 1 | `x = y + 1` | `52de599` | I2, I3; REF descriptor |
| 2 | `*p = y + 1` (stack target) | `9330da2` | `DEREF`, `pointee` REF; identity-by-name survives one indirection |
| 3 | `*p = y + 1` (heap target) | `97dcfbf` | I1; falsified identity-by-name; object-owned oid at birth |

Post-build calibration held throughout: **zero net new primitives** invented beyond the predicted set, and **one predicted primitive retired** (standalone `VALUE`) — the sign the invariants captured the right architecture without over-designing the representation.
