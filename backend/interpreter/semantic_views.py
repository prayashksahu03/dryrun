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


def _map_adjacency(val: dict):
    """Build (n, mat) from a map<int, vector<int>> adjacency structure, or None.
    Keys are node ids; each value is that node's neighbour list."""
    data = val.get('data')
    if not isinstance(data, dict) or not data:
        return None
    adj = {}
    ids = set()
    for k, v in data.items():
        try:
            ki = int(k)
        except (TypeError, ValueError):
            return None
        if ki < 0 or not (isinstance(v, dict) and v.get('kind') == 'array'):
            return None
        nbrs = []
        for x in v.get('values', []):
            xi = _as_int(x)
            if xi is None or xi < 0:
                return None
            nbrs.append(xi)
        adj[ki] = nbrs
        ids.add(ki)
        ids.update(nbrs)
    if not ids:
        return None
    n = max(ids) + 1
    if n < _MIN_N or n > _MAX_N:
        return None
    mat = [[0] * n for _ in range(n)]
    for u, nbrs in adj.items():
        for w in nbrs:
            if w < n:
                mat[u][w] = 1
    if all(all(v == 0 for v in row) for row in mat):
        return None
    return n, mat


def _detect_structure(mem: dict):
    """Return (oid, n, mat, directed, wmat_or_None) for the first stack object
    that looks like a graph — adjacency matrix, adjacency list, edge list, or a
    map<int, vector<int>> — else None."""
    # Map-based adjacency (map / unordered_map keyed by node id).
    for frame in mem.get('stack', []):
        for name, val in frame.get('variables', {}).items():
            if isinstance(val, dict) and val.get('kind') == 'map':
                built = _map_adjacency(val)
                if built is not None:
                    n, mat = built
                    return _oid_of(val, name), n, mat, not _is_symmetric(mat, n), None

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

def _detect_roles(mem: dict, n: int, mat=None) -> dict:
    """Resolve the observable execution roles for this snapshot: visited set,
    current/parent node, and the frontier (a container, or the call stack of a
    recursive traversal). `mat` is the adjacency matrix, used to recognise the
    recursion path."""
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

    # frontier: the queue / stack / priority_queue container of node ids (the
    # wavefront). The container's discipline distinguishes the algorithm — a
    # priority_queue frontier is what makes Dijkstra/Prim look different from BFS
    # — so it is a first-class role, never inferred from a variable name.
    frontier = None
    for frame in stack:
        for name, vval in frame.get('variables', {}).items():
            if not (isinstance(vval, dict) and vval.get('kind') == 'array'):
                continue
            ct = (vval.get('ctype') or '').lower()
            if 'priority_queue' in ct:
                kind = 'pq'          # check before 'queue' (substring of it)
            elif 'stack' in ct:
                kind = 'stack'
            elif 'queue' in ct or 'deque' in ct:
                kind = 'queue'
            else:
                continue
            members = _frontier_members(vval.get('values'), n)
            if members is not None:
                frontier = {'kind': kind, 'members': members, 'oid': _oid_of(vval, name)}
                break
        if frontier is not None:
            break

    # No container frontier? A recursive DFS has no frontier container — the
    # CALL STACK is the frontier. The set of open recursive frames' node
    # arguments IS the DFS path/wavefront, innermost = current.
    if frontier is None:
        cs = _callstack_frontier(stack, n, mat)
        if cs is not None:
            frontier = cs

    # distance: the per-node distance array of a weighted traversal. Only looked
    # for when the frontier is a priority_queue (Dijkstra/Prim), and identified
    # structurally — a length-n int array holding at least one value >= n, i.e.
    # values OUTSIDE the node-index range. That separates a distance array from a
    # parent array (node indices) or a visited array (0/1), name-free.
    distance = None
    if frontier is not None and frontier['kind'] == 'pq':
        for frame in stack:
            for name, vval in frame.get('variables', {}).items():
                if not (isinstance(vval, dict) and vval.get('kind') == 'array') or vval.get('rows'):
                    continue
                arr = vval.get('values')
                if not (isinstance(arr, list) and len(arr) == n):
                    continue
                ints = [_as_int(x) for x in arr]
                if any(x is None for x in ints):
                    continue
                if any(x >= n for x in ints):
                    distance = {'oid': _oid_of(vval, name), 'values': ints}
                    break
            if distance is not None:
                break

    return {'visited': visited_nodes, 'visited_oid': visited_oid,
            'current': current, 'parent': parent, 'frontier': frontier,
            'distance': distance}


def _frontier_members(raw, n):
    """Node ids held in a frontier container. Elements may be plain ints (BFS/DFS)
    or {dist,node} pairs (a priority_queue). For pairs, the node is the field that
    is a valid index for every element — preferring `second`, since a Dijkstra pq
    is conventionally {distance, node}."""
    if not isinstance(raw, list):
        return None
    ints = [_as_int(x) for x in raw]
    if ints and all(x is not None and 0 <= x < n for x in ints):
        return ints
    if raw and all(isinstance(x, dict) and x.get('kind') == 'struct' for x in raw):
        firsts, seconds, ok_f, ok_s = [], [], True, True
        for x in raw:
            f = x.get('fields') or {}
            fv, sv = _as_int(f.get('first')), _as_int(f.get('second'))
            if fv is None or not (0 <= fv < n):
                ok_f = False
            if sv is None or not (0 <= sv < n):
                ok_s = False
            firsts.append(fv)
            seconds.append(sv)
        if ok_s:
            return seconds
        if ok_f:
            return firsts
    return None


def _callstack_frontier(stack, n, mat):
    """The call stack of a recursive traversal, as a frontier. Among the frames
    of the innermost (recursive) function, the node argument is the int variable —
    present in every such frame — whose per-frame values form a connected simple
    PATH in the graph. That path is the DFS wavefront; the innermost is current.
    Returns {kind:'callstack', members:[path]} or None."""
    if len(stack) < 2:
        return None
    func = stack[-1].get('function')
    rec = [f for f in stack if f.get('function') == func]
    if len(rec) < 2:
        return None

    inner_vars = rec[-1].get('variables', {})
    best = None
    for name, v in inner_vars.items():
        if not (isinstance(v, dict) and v.get('kind') == 'int'):
            continue
        seq = []
        ok = True
        for f in rec:
            fv = f.get('variables', {}).get(name)
            if (isinstance(fv, dict) and fv.get('kind') == 'int'
                    and isinstance(fv.get('value'), int) and 0 <= fv['value'] < n):
                seq.append(fv['value'])
            else:
                ok = False
                break
        if not ok or len(set(seq)) != len(seq):     # must be present in all & distinct
            continue
        if mat is not None and not all(mat[seq[i]][seq[i + 1]] for i in range(len(seq) - 1)):
            continue                                 # consecutive frames must be adjacent
        if best is None or len(seq) > len(best):
            best = seq
    if not best or len(best) < 1:
        return None
    return {'kind': 'callstack', 'members': best}


def _algorithm_label(roles: dict) -> Optional[str]:
    """Derived, non-load-bearing hint. Never gates rendering."""
    fr = roles.get('frontier')
    has_visited = roles.get('visited') is not None
    if fr and fr['kind'] == 'pq':
        return 'Dijkstra'
    if fr and fr['kind'] == 'queue' and has_visited:
        return 'BFS'
    if fr and fr['kind'] in ('stack', 'callstack') and has_visited:
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
            _, n, mat, _, _ = st
            r = _detect_roles(mem, n, mat)
        else:
            r = None
        roles_per_step.append(r)
        if first_live is None and r is not None and (
            r['visited'] is not None or r['current'] is not None or r.get('frontier') is not None
        ):
            first_live = i

    if first_live is None:
        return  # this run never traverses a graph — don't render incidental arrays

    # The run IS a graph traversal (confirmed by first_live), so render the graph
    # from the EARLIEST step its structure exists — i.e. as vertices and edges are
    # assigned, the graph builds up edge by edge, before the traversal loop starts.
    # (The `first_live` confirmation is what still keeps a boolean DP table, which
    # never traverses, from being drawn as a graph.)
    for i, step in enumerate(trace):
        st = structures[i]
        if st is None:
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
            'distance': r.get('distance'),
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

# ── cell dependencies (DP / prefix-sum recurrences) ──────────────────────────
#
# Not a declared "DP type" — a projection over the causal WRITE and its feeding
# READs. When a write to arr[i] is computed from other cells of the SAME array,
# those cells are its dependencies. We only surface this for a *sustained fill*
# (self-referential writes across several steps), so an incidental one-off read
# (a swap) never draws dependency links.

_DEPS_MIN_FILL_STEPS = 3


def _cell_key(ref: dict):
    """Hashable identity of a cell ref — 1D ('i', index) or 2D ('rc', row, col)."""
    if ref.get('index') is not None:
        return ('i', ref['index'])
    if ref.get('row') is not None and ref.get('col') is not None:
        return ('rc', ref['row'], ref['col'])
    return None


def _cell_out(key):
    """Serialized cell for the descriptor — a bare index (1D) or {r,c} (2D)."""
    return key[1] if key[0] == 'i' else {'r': key[1], 'c': key[2]}


def _classify_2d_deps(wkey, dep_keys):
    """Classify a 2D self-referential write's access pattern, name-free:

      NEIGHBOR  — reads offset cells (i±1, j±1): grid / knapsack DP.
      PIVOT     — reads (r,k) and (k,c) sharing a third index k that is FAR from
                  the write (|k-r|>1 or |k-c|>1): a through-pivot relaxation, i.e.
                  all-pairs shortest path / transitive closure (Floyd-Warshall).

    The far-k guard is what separates a genuine pivot from the neighbour case,
    where the shared index is always k = r-1 = c-1 (distance 1 from both)."""
    if wkey[0] != 'rc':
        return 'neighbor', None
    r, c = wkey[1], wkey[2]
    cells = {(k[1], k[2]) for k in dep_keys if k[0] == 'rc'}
    for (a, b) in cells:
        if a == r and b not in (r, c):            # (r, k) shares the write's row
            k = b
            if (k, c) in cells and (abs(k - r) > 1 or abs(k - c) > 1):
                return 'pivot', k
        if b == c and a not in (r, c):            # (k, c) shares the write's col
            k = a
            if (r, k) in cells and (abs(k - r) > 1 or abs(k - c) > 1):
                return 'pivot', k
    return 'neighbor', None


def _annotate_deps(trace: list) -> None:
    per_oid: dict = {}
    records = []  # per step: (oid, cell_key, [dep cell_keys]) or None
    for step in trace:
        ev = step.get('event') if isinstance(step, dict) else None
        cause = ev.get('cause') if isinstance(ev, dict) else None
        if not (isinstance(cause, list) and cause):
            records.append(None)
            continue
        write = next((o for o in reversed(cause)
                      if o.get('op') == 'WRITE' and (o.get('ref') or {}).get('kind') == 'cell'), None)
        if not write:
            records.append(None)
            continue
        woid = write['ref'].get('container_oid')
        wkey = _cell_key(write['ref'])
        if woid is None or wkey is None:
            records.append(None)
            continue
        deps = []
        for o in cause:
            if o.get('op') != 'READ':
                continue
            ref = o.get('ref') or {}
            if ref.get('kind') == 'cell' and ref.get('container_oid') == woid:
                dk = _cell_key(ref)
                if dk is not None and dk != wkey:
                    deps.append(dk)
        if deps:
            records.append((woid, wkey, sorted(set(deps))))
            per_oid[woid] = per_oid.get(woid, 0) + 1
        else:
            records.append(None)

    keep = {oid for oid, c in per_oid.items() if c >= _DEPS_MIN_FILL_STEPS}
    if not keep:
        return

    # An oid whose fill EVER uses a through-pivot relaxation is an all-pairs /
    # transitive-closure matrix (Floyd-Warshall class) — a graph algorithm that
    # would otherwise be mistaken for plain neighbour DP.
    pivot_oids = set()
    for rec in records:
        if rec is None:
            continue
        woid, wkey, deps = rec
        if woid in keep and _classify_2d_deps(wkey, deps)[0] == 'pivot':
            pivot_oids.add(woid)

    for i, rec in enumerate(records):
        if rec is None:
            continue
        woid, wkey, deps = rec
        if woid not in keep:
            continue
        kind, k = _classify_2d_deps(wkey, deps)
        out = {'oid': woid, 'cell': _cell_out(wkey),
               'dependsOn': [_cell_out(dk) for dk in deps], 'kind': kind}
        if k is not None:
            out['pivot'] = k
        # The whole object is a pivot-relaxation matrix if any write relaxes via a
        # pivot — surface that so the view can name it (all-pairs shortest paths).
        out['allPairs'] = woid in pivot_oids
        trace[i]['deps'] = out


def annotate_trace(trace: list) -> list:
    """Attach semantic-view descriptors to each step, in place. Returns trace.

    DSU and cell-dependencies are declared stack projections and run always.
    Grid projection then takes precedence over the graph reading: a 2D-cell
    traversal renders as a grid, never flattened into abstract nodes."""
    if not isinstance(trace, list) or not trace:
        return trace
    _annotate_dsu(trace)
    _annotate_deps(trace)
    if _annotate_grid(trace):
        return trace
    _annotate_graph(trace)
    return trace
