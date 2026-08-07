# DryRun Design System v1

*A visual + interaction design system for an educational execution visualizer.*
*Goal: a beginner should understand **what happened** without reading the code.*

This document is the consolidated output of a multi-pass design collaboration (trace-contract audit → visualization audit → pedagogy audit → cognitive redesign → convergence). It is organized so it stays maintainable: **Philosophy** (why), a **Constitution** (precedence when rules conflict), the six **Grammars** (how), the two **Flagship Builds** (what to build first), **Anti-patterns** (what is forbidden), and an **Evaluation** battery (how we know it works).

---

## 0. Philosophy (global principles — not grammars)

These are not visual rules; they are the stance the whole product takes.

1. **DryRun is an educational execution visualizer, not a debugger.** Optimize every decision for *long-term memory formation*, not for feature-completeness or aesthetics.
2. **The backend declares meaning; the frontend renders it.** Semantics travel *with* the trace.
3. **The frontend never guesses.** No dispatch on variable names, array shapes, sizes, or matrix symmetry when the meaning is known.
4. **Every silent state change becomes a visible causal gesture.** If something changed and nothing moved, the trace failed.
5. **State is not enough — identity, cause, and lifetime must be first-class.** The trace answers *what object is this, where does it live, what does it refer to, and what just happened to it, in order.*

---

## 1. The Constitution (law hierarchy)

Grammars can conflict (e.g. "this animation looks better if the nodes move" vs. "identity must be preserved"). When they do, **lower-numbered laws win.** This is the decision procedure for every design call.

- **LAW 0 — Semantic truth beats everything.** Never render something as what it is not. If `semantic_type` says DP-table, it is never drawn as a graph, however tempting.
- **LAW 1 — Identity is never sacrificed.** No animation, layout, or reuse may imply that two distinct objects are one, or that one object is two. (Example decision: *"nodes moving looks cooler" → does it violate identity? → yes → reject.*)
- **LAW 2 — One channel, one meaning.** A visual channel (fill, motion, position, edge color) encodes exactly one axis of meaning, everywhere, always.
- **LAW 3 — Attention is singular.** Exactly one object owns focus at any instant.
- **LAW 4 — Motion means an event.** Idle state does not animate; motion is reserved for things that happened.
- **LAW 5 — Teach the misconception, then break it.** Prefer the representation that forces the correct mental model over the one that is merely pretty.

> The laws are the constitution. Grammars are legislation under them. Any grammar rule that violates a higher law is void.

---

## 2. The Six Grammars

### G1 — Semantic Grammar (*what a thing is*)
- Every object in the trace carries an explicit closed-enum `semantic_type`:
  `RAW_ARRAY, VECTOR, STACK, QUEUE, DEQUE, PQ_HEAP, SET_ORDERED, SET_HASHED, MAP_ORDERED, MAP_HASHED, STRING, LIST_SINGLY, LIST_DOUBLY, TREE_BINARY, TREE_BST, TRIE, SEGTREE, FENWICK_BIT, DSU, GRAPH_DIRECTED, GRAPH_UNDIRECTED, MATRIX, DP_TABLE, GRID, UNKNOWN`.
- Plus a **role map** for sub-parts: which field is `parent`/`next`/`left`/`right`, which array is `tree`, the index base, directedness.
- **Rule:** the renderer dispatches *only* on `semantic_type`. Names, shapes, sizes, and symmetry are consulted **only when `semantic_type == UNKNOWN`** (raw C arrays with no annotation).
- **View/lens rule:** alternative visualizations (call-graph / recursion tree, graph-traversal frontier, DP-dependency, segtree-range) are *offered* only when the trace declares the corresponding **capability** (e.g. `execution_model = CALL_GRAPH`). Views are keyed on declared capabilities, never on inferred structure; the **user** selects which offered view is primary, and a safe familiar default (e.g. the call stack) is never silently replaced.
- Kills at the root: DP-table vs adjacency-matrix, directed-graph-that-happens-to-be-symmetric, and the `dsu`/`bit`/`tree` name collisions.

### G2 — Identity Grammar (*which object*)
- Every object gets a **stable per-object identity token** (`oid`), assigned at construction, never reused, **decoupled from address and position.**
- Every object visually answers: **Am I alive? Am I moving? Am I copied?**
- Identity travels with the object through motion, so animation can move a thing freely without implying it became something else. This is the keystone that makes Move≠Copy, ABA/heap-reuse, and frame-reuse expressible.

### G3 — Color Grammar (*orthogonal axes, never sharing a channel*)
Region and lifecycle are **two orthogonal axes** and must not collide in one fill (a fresh heap block cannot be both "purple = heap" and "green = new"). Split them:

| Axis | Channel | Encoding |
|---|---|---|
| **Region** | spatial zone + thin **border tint** | stack / heap / static-global / temp |
| **Lifecycle** | **fill ramp** | born (green) → live (neutral) → dead (grey) → dangling (red) |
| **Focus** | one reserved **accent (orange)** | active execution — used *nowhere else* |
| **Identity** | a stable **token/swatch** | per-object, see G2 |
| **Relationship** | **edge color** | valid / dangling / null |

> Never reuse a color for unrelated concepts. Structural roles (L/R child, front/back, root) use **position + label**, never a hue.

### G4 — Motion Grammar (*one meaning per motion, chosen by the Mover Principle*)

**The Mover Principle:** animate whatever carries identity.
- **Identity-addressed** structures (object boxes, list/tree/DSU nodes) → **move the object / sweep the arrow.**
- **Index-addressed** structures (array, heap-as-array, DP table, string) → positions are indices, not identities, so **the value travels between fixed slots.**

| Motion | Meaning | Fires on |
|---|---|---|
| **Travel** | identity / ownership moves | move; swap on identity-bearing boxes/nodes |
| **Pulse** | in-place mutation | value change on an index-addressed slot |
| **Sweep** | pointer / reference repoint | `p = q` |
| **Split** | copy (a duplicate detaches and travels) | copy — so copy ≠ move |
| **Collapse** | scope / lifetime end | stack frame / local out of scope |
| **Free (implode)** | deliberate heap release | `delete` — distinct from Collapse |
| **Fade** | becomes inactive | de-focus |

One timing scale everywhere: `instant 0 / quick 150 / base 250 / emphasis 400 / narrative 600` ms. Spring only for physical travel. Reduced-motion mode replaces every travel with a crossfade + persistent before/after label.

### G5 — Attention Grammar (*where the eye goes, and in what order*)
- **Exactly one object owns the focus accent at any instant. Attention never duplicates.**
- A single step is a **choreographed focus sequence**, and *that order is the cause chain.*
  Example — `parent[x] = y`: highlight `"parent"` → highlight `x` → highlight `parent[x]` → highlight new value → fade affected neighbors → context.
- This folds the Cause Ribbon (below) and Attention into one mechanism: attention is not just *where* but *in what order*.

### G6 — Teaching Grammar (*the conceptual-change loop*)
Every language construct gets the same four-beat script:

**Wrong intuition → Conflict → Animation → Correct mental model.**

Example — **References:** wrong intuition *"`r` is a copy"* → conflict *"I changed `x` and `r` changed too, but there are two boxes?"* → animation *"the two boxes merge into one box with two nameplates"* → correct model *"one object, two names."*

---

## 3. Per-construct application (the misconception → fix table)

| Construct | Beginner misconception | Does DryRun (today) reinforce it? | The fix (v1) |
|---|---|---|---|
| **Recursion** | one `n` that "loops"; unwind invisible | Yes — sibling calls morph into one frame; return is one missable event | Recursion **tree** ↔ stack, call edge labeled with the arg transform (`n → n-1`), return collapses child into parent carrying the value |
| **References** | a reference is a copy | Yes — two equal independent boxes; `ref` dropped | one box, **two nameplates**; single box morphs once |
| **Pointers** | pointer *is* the value; `p=q` vs `*p=v` identical | Partly — stack targets undrawable; both edits animate alike | pointer = box holding an **arrow**; `p=q` = arrowhead **sweeps**; `*p=v` = pointee box **pulses**, arrow still |
| **Stack vs heap** | one memory pool; returning `&local` is fine | Weak — no lifetime contrast; scope-exit silently vanishes | frames **collapse** at scope exit; heap persists to `delete`; returned `&local` = **red arrow into an empty slot** |
| **Aliasing** | "why did the other one change?" | Only heap sharing | ≥2 handles → **convergent arrows onto one token**; the one box flashes once |
| **Pass by value/ref** | unsure if callee mutates caller | Yes — args are strings; identical at boundary | by-value = **copy splits off** into callee; by-ref = **alias arrow back** to caller box; a write travels back through it (or is trapped) |
| **Graph / DFS** | traversal is "magic visiting" | Partly — no frontier; DFS not linked to stack | graph **+ frontier side-by-side**; DFS overlays the recursion tree on the current node (descend=push, return=pop); visited leave a trail; tree- vs back-edges distinguished |

---

## 4. Flagship builds (build these first — the rest of the language falls out)

### Build 1 — The Cause Ribbon
- The trace carries a **decomposed cause chain** per step, e.g. `x = y + 1` → `READ y → ADD 1 → WRITE x`; `*p = 42` → `dereference → heap object #k → value changes`.
- The UI draws a **live connector** from the code token, down through the cause micro-steps, to the exact memory cell it lands on.
- *Why it matters:* it kills the split-attention effect. Today the learner holds the code line in working memory, switches panels, hunts the changed cell, and infers the link — pure extraneous load. The ribbon externalizes the cause→effect binding (frees working memory for the concept) and dual-codes the statement with its spatial target. **Every step now tells a story.**

### Build 2 — Recursion as a user-selectable lens (corrected)
- **View selection is keyed on a *declared capability*, never on inferred structure.** The backend declares `execution_model = CALL_GRAPH` (emitting `call_id` + `call_relationships`); only then does the frontend *offer* the call-graph / recursion-tree lens. No frontend "detect recursion" heuristic — that would violate LAW 0 and the Semantic Grammar.
- **The user picks the primary view by their question; the call stack stays the default** (no silent mid-session swap). Tree and stack are synchronized: Code / Recursion Tree / Current Stack, with the active node, its frame, and the current line **co-highlighted**; **return collapses** the child back into the parent carrying the value.
- **Scale is a rendering concern of the lens, not a reason to withhold it:** show the active path in full, aggregate completed sibling subtrees into collapsed summaries with counts, and **de-duplicate repeated subproblems** — which is the memoization lesson made visible — so the tree stays legible even at `n=30`.
- *Why it matters:* students memorize the call stack but rarely understand it. The branching tree defeats the "loop" schema, each call is a distinct stable location (`fib(3)` appears twice as two different nodes = spatial memory), and the tree is one chunk vs a flat list that exceeds working-memory span.

---

## 5. Design anti-patterns (explicitly forbidden)

- ✗ Never animate because it looks nice.
- ✗ Never encode one concept in two channels.
- ✗ Never encode two concepts in one channel.
- ✗ Never make users infer identity.
- ✗ Never require reading code to understand an animation.
- ✗ Never dispatch from heuristics when semantics exist.
- ✗ Never let more than one object own attention.
- ✗ Never let idle state animate.
- ✗ Never reuse an address/slot in a way that reuses identity.

---

## 6. Evaluation battery (how we know it teaches)

- **Comprehension without code (primary).** Hide the code panel; ask participants to describe what happened and predict the next state. This is the product thesis; it lives or dies here.
- **Discriminability probes (force choice):** move vs copy? reallocation vs append? reference vs pointer? directed vs undirected? Current system is at chance on several; v1 should be near-ceiling.
- **Homonym test:** show an isolated focus-accent element — "what does this color mean?" must have exactly one answer.
- **Motion-as-signal test:** insert an idle distractor animation; measure whether users still detect a real event (predicts that removing idle motion *improves* detection).
- **Accessibility:** re-run all of the above under colorblind simulation and reduced-motion — the language must survive both (it leans on identity tokens + position + labels, not hue + movement alone).

---

*v1 locked. Next: implement Build 1 and Build 2 against the TRACE_CONTRACT_v2 schema (identity `oid`, semantic tags, ordered causal deltas), then extend the per-construct table to the remaining structures under these six grammars.*
