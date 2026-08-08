"""Semantic view resolver — TRACE_CONTRACT_v2, Slice 1.

The frontend must NEVER infer what a structure *is* or which object plays which
algorithmic role. The interpreter declares that, once, as immutable per-step
facts. This module runs as a post-execution pass over a finished trace and, for
each step, attaches two descriptors derived from that step's own snapshot:

  step['graph']     — GraphDescriptor: the graph's STRUCTURE (object semantics).
                      { oid, directed, nodes:[...], edges:[{u,v,w?}] }

  step['execution'] — ExecutionDescriptor: the OBSERVABLE ROLES for this step
                      (execution semantics), each bound to an object identity.
                      { activeObject, current, parent, visited:[...],
                        frontier:{kind, members:[...], oid}, algorithm }

Roles are *assigned by inference here, once* — never re-derived by the renderer.
The algorithm label (BFS/DFS/…) is derived and non-load-bearing: a graph renders
from its roles even when the algorithm is unrecognised.

Graph-never-disappears is baked in: once a run's traversal begins (a step with a
visited set or a current node), the GraphDescriptor is emitted on every later
step where the structure is still present, even after the frontier drains.
"""

from typing import Optional

# Innermost-frame integer variables that, when in range [0, n), name the node
# currently being processed / its parent. Kept small and conventional; the
# renderer never sees these names — only the resolved node id.
_CURRENT_NODE_VARS = ('u', 'node', 'curr', 'current', 'v', 'src', 'source', 'vertex', 'start')
_PARENT_NODE_VARS  = ('parent', 'prev', 'p', 'par')

_MIN_N = 2
_MAX_N = 12


# ── snapshot readers ─────────────────────────────────────────────────────────

def _iter_frame_arrays(mem: dict):
    """Yield (name, value) for every stack variable and one level of struct
    fields (C++ class members), mirroring the previous frontend traversal."""
    for frame in mem.get('stack', []):
        for name, val in frame.get('variables', {}).items():
            if isinstance(val, dict):
                yield name, val
                if val.get('kind') == 'struct':
                    for fname, fv in (val.get('fields') or {}).items():
                        if isinstance(fv, dict):
                            yield f'{name}.{fname}', fv


def _oid_of(val: dict, name: str) -> str:
    """Stable identity handle for an object. Frame variables carry a minted oid;
    struct fields may not, so fall back to a name-derived handle."""
    return val.get('oid') or f'name:{name}'


def _as_int(x) -> Optional[int]:
    """Coerce a serialized element to an int, or None. Elements may be raw ints
    or {'kind':'int','value':N} dicts (how containers store their members)."""
    if isinstance(x, bool):
        return int(x)
    if isinstance(x, int):
        return x
    if isinstance(x, dict) and isinstance(x.get('value'), (int, float)):
        return int(x['value'])
    return None


# ── structure detection ──────────────────────────────────────────────────────

def _matrix_to_edges(mat, n, directed):
    edges = []
    for i in range(n):
        row = mat[i]
        for j in range(n):
            if row[j]:
                if not directed and j <= i:
                    continue
                edges.append({'u': i, 'v': j})
    return edges


def _weighted_matrix_to_edges(mat, wmat, n, directed):
    edges = []
    for i in range(n):
        for j in range(n):
            if mat[i][j]:
                if not directed and j <= i:
                    continue
                edges.append({'u': i, 'v': j, 'w': wmat[i][j]})
    return edges


def _detect_structure(mem: dict):
    """Return (oid, n, mat, directed, wmat_or_None) for the first stack object
    that looks like a graph — adjacency matrix or adjacency list — else None."""
    for name, val in _iter_frame_arrays(mem):
        if val.get('kind') != 'array':
            continue

        rows = val.get('rows')
        cols = val.get('cols')

        # ── Adjacency matrix: NxN of 0/1 ──────────────────────────────────
        if rows and cols and rows == cols:
            n = rows
            if n < _MIN_N or n > _MAX_N:
                continue
            raw = val.get('values')
            if not isinstance(raw, list) or len(raw) != n:
                continue
            ok = all(
                isinstance(r, list) and len(r) >= n
                and all(v in (0, 1) for v in r[:n])
                for r in raw
            )
            if not ok:
                continue
            mat = [list(r[:n]) for r in raw]
            directed = not _is_symmetric(mat, n)
            return _oid_of(val, name), n, mat, directed, None

        # ── 1D array: adjacency list OR edge list ─────────────────────────
        if not rows and not cols:
            outer = val.get('values')
            if not isinstance(outer, list):
                continue
            n = len(outer)
            if _MIN_N <= n <= _MAX_N:
                built = _build_from_adjacency_list(outer, n)
                if built is not None:
                    mat, wmat, weighted = built
                    directed = not _is_symmetric(mat, n)
                    return _oid_of(val, name), n, mat, directed, (wmat if weighted else None)
            # Edge list: a flat vector of {first, second} int pairs. Node count
            # is inferred from the ids, so it is independent of len(outer).
            el = _build_from_edge_list(outer)
            if el is not None:
                en, emat = el
                return _oid_of(val, name), en, emat, False, None
            continue

    return None


def _is_symmetric(mat, n) -> bool:
    for i in range(n):
        for j in range(n):
            if mat[i][j] != mat[j][i]:
                return False
    return True


def _build_from_adjacency_list(outer, n):
    """Build (mat, wmat, weighted) from a list of neighbour lists, or None.

    Neighbours are plain ints, or weighted pairs {first, second} where one field
    is the destination node and the other the weight. Which field is the
    destination is inferred by scanning all pairs (a field whose value ever falls
    outside [0, n) cannot be the destination)."""
    # Must be a list of inner arrays.
    if not all(isinstance(el, dict) and el.get('kind') == 'array'
               and isinstance(el.get('values'), list) for el in outer):
        return None

    weighted = any(
        len(el['values']) > 0 and isinstance(el['values'][0], dict)
        and el['values'][0].get('kind') == 'struct'
        for el in outer
    )

    first_ok = True
    second_ok = True
    for el in outer:
        for nb in el['values']:
            if not (isinstance(nb, dict) and nb.get('kind') == 'struct'):
                continue
            fields = nb.get('fields') or {}
            fv = _as_int(fields.get('first'))
            sv = _as_int(fields.get('second'))
            if fv is not None and not (0 <= fv < n):
                first_ok = False
            if sv is not None and not (0 <= sv < n):
                second_ok = False

    dest_field = 'second' if (not first_ok and second_ok) else 'first'
    weight_field = 'first' if dest_field == 'second' else 'second'

    def dest_of(nb):
        if isinstance(nb, dict):
            if nb.get('kind') == 'struct':
                d = _as_int((nb.get('fields') or {}).get(dest_field))
                return d if (d is not None and 0 <= d < n) else None
            d = _as_int(nb)
            return d if (d is not None and 0 <= d < n) else None
        d = _as_int(nb)
        return d if (d is not None and 0 <= d < n) else None

    def weight_of(nb):
        if isinstance(nb, dict) and nb.get('kind') == 'struct':
            w = _as_int((nb.get('fields') or {}).get(weight_field))
            return w if w is not None else 1
        return 1

    # Every neighbour must resolve to a valid node.
    for el in outer:
        for nb in el['values']:
            if dest_of(nb) is None:
                return None

    mat = [[0] * n for _ in range(n)]
    wmat = [[0] * n for _ in range(n)]
    for i in range(n):
        for nb in outer[i]['values']:
            d = dest_of(nb)
            if d is not None:
                mat[i][d] = 1
                wmat[i][d] = weight_of(nb)

    if all(all(v == 0 for v in row) for row in mat):
        return None  # empty graph — nothing useful to show

    return mat, wmat, weighted


def _build_from_edge_list(outer):
    """Build (n, mat) from a flat list of {first, second} int-pair structs — an
    undirected edge list. Node count is inferred as max node id + 1. Returns None
    unless every element is a clean non-negative int pair and n is in range.

    Only struct pairs are treated as edges (not inner arrays), so this never
    shadows adjacency-list detection, which owns the array-of-arrays shape."""
    if not (isinstance(outer, list) and len(outer) >= 1):
        return None
    pairs = []
    ids = set()
    for el in outer:
        if not (isinstance(el, dict) and el.get('kind') == 'struct'):
            return None
        fields = el.get('fields') or {}
        a = _as_int(fields.get('first'))
        b = _as_int(fields.get('second'))
        if a is None or b is None or a < 0 or b < 0:
            return None
        pairs.append((a, b))
        ids.add(a)
        ids.add(b)
    if not ids:
        return None
    n = max(ids) + 1
    if n < _MIN_N or n > _MAX_N:
        return None
    mat = [[0] * n for _ in range(n)]
    for a, b in pairs:
        mat[a][b] = 1
        mat[b][a] = 1
    return n, mat


# ── role detection ───────────────────────────────────────────────────────────

def _detect_roles(mem: dict, n: int) -> dict:
    """Resolve the observable execution roles for this snapshot: visited set,
    current/parent node, and the frontier container (+ its discipline)."""
    stack = mem.get('stack', [])

    # visited / dist: a length-n array of 0/1 (not a matrix).
    visited_nodes = None
    visited_oid = None
    for frame in stack:
        for name, vval in frame.get('variables', {}).items():
            if not (isinstance(vval, dict) and vval.get('kind') == 'array'):
                continue
            if vval.get('rows'):
                continue
            arr = vval.get('values')
            if not (isinstance(arr, list) and len(arr) == n):
                continue
            ints = [_as_int(x) for x in arr]
            if any(x is None for x in ints):
                continue
            if all(x in (0, 1) for x in ints):
                visited_nodes = [i for i, x in enumerate(ints) if x == 1]
                visited_oid = _oid_of(vval, name)
                break
        if visited_nodes is not None:
            break

    # current / parent from the innermost frame.
    current = None
    parent = None
    if stack:
        innermost = stack[-1].get('variables', {})
        for nm in _CURRENT_NODE_VARS:
            nv = innermost.get(nm)
            if isinstance(nv, dict) and nv.get('kind') == 'int':
                v = nv.get('value')
                if isinstance(v, int) and 0 <= v < n:
                    current = v
                    break
        for nm in _PARENT_NODE_VARS:
            pv = innermost.get(nm)
            if isinstance(pv, dict) and pv.get('kind') == 'int':
                v = pv.get('value')
                if isinstance(v, int) and 0 <= v < n:
                    parent = v
                    break

    # frontier: the queue / stack / deque container of node ids (the wavefront).
    frontier = None
    for frame in stack:
        for name, vval in frame.get('variables', {}).items():
            if not (isinstance(vval, dict) and vval.get('kind') == 'array'):
                continue
            ct = (vval.get('ctype') or '').lower()
            if 'queue' in ct:
                kind = 'queue'
            elif 'stack' in ct:
                kind = 'stack'
            elif 'deque' in ct:
                kind = 'queue'
            else:
                continue
            raw = vval.get('values')
            if not isinstance(raw, list):
                continue
            ints = [_as_int(x) for x in raw]
            if ints and all(x is not None and 0 <= x < n for x in ints):
                frontier = {'kind': kind, 'members': ints, 'oid': _oid_of(vval, name)}
                break
        if frontier is not None:
            break

    return {'visited': visited_nodes, 'visited_oid': visited_oid,
            'current': current, 'parent': parent, 'frontier': frontier}


def _algorithm_label(roles: dict) -> Optional[str]:
    """Derived, non-load-bearing hint. Never gates rendering."""
    fr = roles.get('frontier')
    has_visited = roles.get('visited') is not None
    if fr and fr['kind'] == 'queue' and has_visited:
        return 'BFS'
    if fr and fr['kind'] == 'stack' and has_visited:
        return 'DFS'
    return None


# ── grid projection ──────────────────────────────────────────────────────────
#
# A grid is NOT a graph — it is a 2D-cell structure onto which a neighbour
# relation is projected. So we render the grid natively (rows × cols of cells)
# and overlay the traversal, rather than flattening cells into abstract nodes.

_MAX_GRID_CELLS = 400  # up to 20×20

# Conventional (row, col) variable pairs for the cell being processed. The
# renderer never sees these names — only the resolved cell.
_CURRENT_CELL_PAIRS = (('r', 'c'), ('x', 'y'), ('row', 'col'), ('i', 'j'),
                       ('cr', 'cc'), ('ci', 'cj'))


def _iter_2d_arrays(mem: dict):
    for frame in mem.get('stack', []):
        for name, val in frame.get('variables', {}).items():
            if (isinstance(val, dict) and val.get('kind') == 'array'
                    and val.get('rows') and val.get('cols')):
                yield name, val


def _grid_sig(val: dict):
    r, c = val.get('rows'), val.get('cols')
    vals = val.get('values')
    if not isinstance(vals, list):
        return None
    try:
        return tuple(tuple(row[:c]) for row in vals[:r])
    except Exception:
        return None


def _grid_cells(val: dict):
    r, c = val['rows'], val['cols']
    out = []
    for row in val['values'][:r]:
        out.append([(_as_int(x) if _as_int(x) is not None else x) for x in row[:c]])
    return out


def _find_2d_by_oid(mem: dict, oid: str):
    for _name, val in _iter_2d_arrays(mem):
        if _oid_of(val, _name) == oid:
            return val
    return None


def _cell_queue(mem: dict, rows: int, cols: int):
    """A queue/stack/deque of cell pairs (the grid frontier), or None."""
    for frame in mem.get('stack', []):
        for name, vval in frame.get('variables', {}).items():
            if not (isinstance(vval, dict) and vval.get('kind') == 'array'):
                continue
            ct = (vval.get('ctype') or '').lower()
            if 'stack' in ct:
                kind = 'stack'
            elif 'queue' in ct or 'deque' in ct:
                kind = 'queue'
            else:
                continue
            raw = vval.get('values')
            if not isinstance(raw, list):
                continue
            cells = []
            ok = True
            for el in raw:
                if not (isinstance(el, dict) and el.get('kind') == 'struct'):
                    ok = False
                    break
                f = el.get('fields') or {}
                a = _as_int(f.get('first'))
                b = _as_int(f.get('second'))
                if a is None or b is None or not (0 <= a < rows and 0 <= b < cols):
                    ok = False
                    break
                cells.append({'r': a, 'c': b})
            if ok and cells:
                return {'kind': kind, 'cells': cells, 'oid': _oid_of(vval, name)}
    return None


def _grid_roles(mem: dict, rows: int, cols: int, visited_oid: str):
    visited_arr = _find_2d_by_oid(mem, visited_oid)
    visited_cells = None
    if visited_arr is not None:
        vals = visited_arr.get('values') or []
        visited_cells = []
        for i in range(min(rows, len(vals))):
            row = vals[i]
            for j in range(min(cols, len(row))):
                if _as_int(row[j]) == 1:
                    visited_cells.append({'r': i, 'c': j})

    current = None
    innermost = mem['stack'][-1].get('variables', {}) if mem.get('stack') else {}
    for rn, cn in _CURRENT_CELL_PAIRS:
        rv, cv = innermost.get(rn), innermost.get(cn)
        if (isinstance(rv, dict) and rv.get('kind') == 'int'
                and isinstance(cv, dict) and cv.get('kind') == 'int'):
            a, b = rv.get('value'), cv.get('value')
            if isinstance(a, int) and isinstance(b, int) and 0 <= a < rows and 0 <= b < cols:
                current = {'r': a, 'c': b}
                break
    if current is None:
        # a `cur`/`p`/`cell` pair struct
        for nm in ('cur', 'cell', 'p', 'node', 'front'):
            sv = innermost.get(nm)
            if isinstance(sv, dict) and sv.get('kind') == 'struct':
                f = sv.get('fields') or {}
                a, b = _as_int(f.get('first')), _as_int(f.get('second'))
                if a is not None and b is not None and 0 <= a < rows and 0 <= b < cols:
                    current = {'r': a, 'c': b}
                    break

    fr = _cell_queue(mem, rows, cols)
    return {'visitedCells': visited_cells, 'current': current, 'frontier': fr}


def _annotate_grid(trace: list) -> bool:
    """If this run is a 2D-cell traversal, attach grid/execution descriptors and
    return True. Otherwise leave the trace untouched and return False."""
    # Classify 2D arrays across the whole run: a terrain grid is static, a
    # visited map is dynamic (cells flip as the traversal proceeds).
    twod: dict = {}
    for step in trace:
        mem = step.get('memory') if isinstance(step, dict) else None
        if not mem:
            continue
        for name, val in _iter_2d_arrays(mem):
            r, c = val.get('rows'), val.get('cols')
            if not (isinstance(r, int) and isinstance(c, int)) or r < 1 or c < 1 or r * c > _MAX_GRID_CELLS:
                continue
            oid = _oid_of(val, name)
            info = twod.setdefault(oid, {'shape': (r, c), 'sigs': set(), 'sample': None})
            sig = _grid_sig(val)
            if sig is not None:
                info['sigs'].add(sig)
                info['sample'] = _grid_cells(val)  # keep latest; terrain is stable anyway
    if not twod:
        return False

    dynamic = {oid: i for oid, i in twod.items() if len(i['sigs']) >= 2}
    static  = {oid: i for oid, i in twod.items() if len(i['sigs']) <= 1}

    # visited = a dynamic 2D array that is always 0/1 across every observed state.
    visited_oid = None
    shape = None
    for oid, info in dynamic.items():
        if all(v in (0, 1) for sig in info['sigs'] for row in sig for v in row):
            visited_oid, shape = oid, info['shape']
            break
    if visited_oid is None:
        return False  # no 2D visited map — not a grid traversal we can narrate

    rows, cols = shape

    # terrain grid = a static 2D array of the same shape; else the visited map's
    # shape defines a neutral (all-open) grid (in-place fills have no separate map).
    grid_oid, grid_cells = None, None
    for oid, info in static.items():
        if info['shape'] == shape:
            grid_oid, grid_cells = oid, info['sample']
            break
    if grid_cells is None:
        grid_oid = visited_oid
        grid_cells = [[0] * cols for _ in range(rows)]

    # Per-step roles + first live step.
    roles = []
    first_live = None
    for i, step in enumerate(trace):
        mem = step.get('memory') if isinstance(step, dict) else None
        r = _grid_roles(mem, rows, cols, visited_oid) if mem else None
        roles.append(r)
        # Require a genuine CELL signal — a cell-queue or a current-cell coordinate
        # pair. A visited map alone is not enough: an adjacency matrix is also a
        # dynamic 0/1 2D array (it flips during construction) but has no cell
        # traversal, so it must fall through to the graph reading instead.
        if first_live is None and r is not None and (
            r['current'] is not None or r['frontier'] is not None
        ):
            first_live = i
    if first_live is None:
        return False

    for i, step in enumerate(trace):
        if i < first_live:
            continue
        r = roles[i] or {}
        fr = r.get('frontier')
        step['grid'] = {
            'oid': grid_oid,
            'rows': rows,
            'cols': cols,
            'cells': grid_cells,
        }
        step['execution'] = {
            'activeObject': grid_oid,
            'currentCell': r.get('current'),
            'visitedCells': r.get('visitedCells'),
            'frontierCells': fr['cells'] if fr else None,
            'frontierKind': fr['kind'] if fr else None,
            'algorithm': ('BFS' if fr and fr['kind'] == 'queue'
                          else 'DFS' if fr and fr['kind'] == 'stack' else None),
        }
    return True


# ── public entrypoint ────────────────────────────────────────────────────────

def _annotate_graph(trace: list) -> None:
    structures = []
    roles_per_step = []
    first_live = None
    for i, step in enumerate(trace):
        mem = step.get('memory') if isinstance(step, dict) else None
        st = _detect_structure(mem) if mem else None
        structures.append(st)
        if st is not None:
            _, n, _, _, _ = st
            r = _detect_roles(mem, n)
        else:
            r = None
        roles_per_step.append(r)
        if first_live is None and r is not None and (
            r['visited'] is not None or r['current'] is not None or r.get('frontier') is not None
        ):
            first_live = i

    if first_live is None:
        return

    for i, step in enumerate(trace):
        st = structures[i]
        if st is None or i < first_live:
            continue
        oid, n, mat, directed, wmat = st
        edges = (_weighted_matrix_to_edges(mat, wmat, n, directed)
                 if wmat is not None else _matrix_to_edges(mat, n, directed))
        step['graph'] = {
            'oid': oid,
            'directed': directed,
            'nodes': list(range(n)),
            'edges': edges,
        }
        r = roles_per_step[i] or {}
        step['execution'] = {
            'activeObject': oid,
            'current': r.get('current'),
            'parent': r.get('parent'),
            'visited': r.get('visited'),
            'frontier': r.get('frontier'),
            'algorithm': _algorithm_label(r),
        }


# ── DSU (disjoint-set / union-find) as a declared object ─────────────────────
#
# A parent array and an ordinary result array are BOTH vector<int> — the type
# and values alone can't tell them apart, and guessing from the variable name
# violates the core law (it is what makes `res` false-positive as a DSU). The
# only name-free evidence is structural: does the array currently form a valid
# parent-forest? We declare DSU when it does AND the run ever shows a genuine
# multi-tree forest (>= 2 roots) — which rules out a zero-initialised result
# array (all cells point to node 0: a valid but single-root "forest").

_MAX_DSU_N = 64


def _parent_ints(val: dict, n: int):
    vals = val.get('values')
    if not isinstance(vals, list) or len(vals) != n:
        return None
    out = []
    for x in vals:
        xi = _as_int(x)
        if xi is None:
            return None
        out.append(xi)
    return out


def _forest_roots(parent, n):
    """Return the root list if `parent` is a valid forest (every value in [0,n),
    and following x -> parent[x] from every node terminates at a self-root with
    no cycle of length >= 2), else None."""
    for v in parent:
        if not (0 <= v < n):
            return None
    for i in range(n):
        x = i
        steps = 0
        while parent[x] != x:
            x = parent[x]
            steps += 1
            if steps > n:
                return None  # a cycle of length >= 2 — not a forest
    return [j for j in range(n) if parent[j] == j]


def _iter_1d_int_arrays(mem: dict):
    for frame in mem.get('stack', []):
        for name, val in frame.get('variables', {}).items():
            if (isinstance(val, dict) and val.get('kind') == 'array'
                    and not val.get('rows') and not val.get('cols')):
                yield name, val


def _annotate_dsu(trace: list) -> None:
    """Declare which 1D int arrays are disjoint-set forests, per step. Orthogonal
    to graph/grid (DSU is a stack object), so it always runs."""
    info: dict = {}  # oid -> {all_forest, max_roots, seen}
    for step in trace:
        mem = step.get('memory') if isinstance(step, dict) else None
        if not mem:
            continue
        for name, val in _iter_1d_int_arrays(mem):
            n = len(val.get('values') or [])
            if n < 2 or n > _MAX_DSU_N:
                continue
            parent = _parent_ints(val, n)
            if parent is None:
                continue
            oid = _oid_of(val, name)
            rec = info.setdefault(oid, {'all_forest': True, 'saw_identity': False, 'n': n})
            roots = _forest_roots(parent, n)
            if roots is None:
                rec['all_forest'] = False
            elif len(roots) == n:
                # Every node is its own root: the identity forest (make_set). A
                # result array essentially never equals the full identity
                # permutation, so this is the distinguishing DSU signal.
                rec['saw_identity'] = True

    dsu_oids = {oid for oid, r in info.items()
                if r['all_forest'] and r['saw_identity']}
    if not dsu_oids:
        return

    for step in trace:
        mem = step.get('memory') if isinstance(step, dict) else None
        if not mem:
            continue
        present = []
        for name, val in _iter_1d_int_arrays(mem):
            oid = _oid_of(val, name)
            if oid not in dsu_oids:
                continue
            n = len(val.get('values') or [])
            parent = _parent_ints(val, n)
            if parent is not None and _forest_roots(parent, n) is not None:
                present.append(oid)
        if present:
            step['dsu'] = {'oids': present}


# ── public entrypoint ────────────────────────────────────────────────────────

def annotate_trace(trace: list) -> list:
    """Attach semantic-view descriptors to each step, in place. Returns trace.

    DSU is a declared stack object and runs always. Grid projection then takes
    precedence over the graph reading: a 2D-cell traversal renders as a grid,
    never flattened into abstract nodes."""
    if not isinstance(trace, list) or not trace:
        return trace
    _annotate_dsu(trace)
    if _annotate_grid(trace):
        return trace
    _annotate_graph(trace)
    return trace
