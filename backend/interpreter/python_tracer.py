"""
Python execution tracer using sys.settrace.
Produces a trace list in MemTrace's TraceStep format.
"""
from __future__ import annotations
import sys
import copy

MAX_STEPS = 800

_SKIP_NAMES = frozenset({
    'print', 'range', 'len', 'min', 'max', 'abs', 'sum', 'sorted',
    'enumerate', 'zip', 'map', 'filter', 'list', 'dict', 'set', 'tuple',
    'int', 'str', 'float', 'bool', 'input', 'open', 'type', 'isinstance',
    'hasattr', 'getattr', 'setattr', 'reversed', 'any', 'all', 'id',
})


# ── Type conversion ────────────────────────────────────────────────────

def _to_int(v) -> int:
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return int(v)
    return 0


def _find_diff_1d(prev: list, curr: list):
    """Return index of first changed element, or None."""
    for i in range(min(len(prev), len(curr))):
        if curr[i] != prev[i]:
            return i
    if len(curr) > len(prev):
        return len(prev)
    return None


def _find_diff_2d(prev: list, curr: list):
    """Return [row, col] of first changed element, or None."""
    for i in range(min(len(prev), len(curr))):
        p_row = prev[i] if isinstance(prev[i], list) else []
        c_row = curr[i] if isinstance(curr[i], list) else []
        for j in range(min(len(p_row), len(c_row))):
            if c_row[j] != p_row[j]:
                return [i, j]
        if len(c_row) > len(p_row):
            return [i, len(p_row)]
    return None


def _val_to_memtrace(val, prev_mv: dict | None = None) -> dict:
    if isinstance(val, bool):
        return {'kind': 'int', 'value': int(val)}
    if isinstance(val, int):
        return {'kind': 'int', 'value': val}
    if isinstance(val, float):
        return {'kind': 'int', 'value': int(val)}
    if isinstance(val, str):
        return {'kind': 'char', 'value': val[:64]}
    if isinstance(val, list):
        # 2D: all elements are lists
        if val and all(isinstance(x, list) for x in val):
            rows = len(val)
            cols = max((len(r) for r in val), default=0)
            values = [[_to_int(v) for v in row] for row in val]
            result: dict = {'kind': 'array', 'values': values, 'rows': rows, 'cols': cols}
            if prev_mv and prev_mv.get('kind') == 'array':
                lw = _find_diff_2d(prev_mv.get('values', []), values)
                if lw:
                    result['lastWrite'] = lw
            return result
        # 1D
        values_1d = [_to_int(v) for v in val]
        result = {'kind': 'array', 'values': values_1d}
        if prev_mv and prev_mv.get('kind') == 'array':
            lw = _find_diff_1d(prev_mv.get('values', []), values_1d)
            if lw is not None:
                result['lastWrite'] = [lw]
        return result
    # Fallback: try int
    try:
        return {'kind': 'int', 'value': int(val)}
    except Exception:
        return {'kind': 'int', 'value': 0}


def _snapshot(frame_locals: dict, prev: dict) -> dict:
    result = {}
    for name, val in frame_locals.items():
        if name.startswith('_') or name in _SKIP_NAMES:
            continue
        if callable(val) and not isinstance(val, (int, float, bool, str, list)):
            continue  # skip function objects, classes, lambdas
        try:
            result[name] = _val_to_memtrace(val, prev.get(name))
        except Exception:
            pass
    return result


# ── Tracer ─────────────────────────────────────────────────────────────

class PythonTracer:
    def __init__(self, source: str):
        self.source = source
        self.source_lines = source.split('\n')

    def _src_line(self, n: int) -> str:
        if 0 < n <= len(self.source_lines):
            return self.source_lines[n - 1].strip()
        return f'line {n}'

    def run(self) -> list:
        trace: list = []
        call_stack: list[dict] = []
        # id(frame) → previous memtrace snapshot
        frame_prev: dict[int, dict] = {}
        step_count = [0]

        def _emit(line: int, desc: str, event: dict):
            if step_count[0] >= MAX_STEPS:
                return
            trace.append({
                'index': len(trace),
                'line': line,
                'description': desc,
                'event': event,
                'memory': {
                    'stack': [copy.deepcopy(sf) for sf in call_stack],
                    'heap': {}
                },
            })
            step_count[0] += 1

        def tracer(frame, event, arg):
            if step_count[0] >= MAX_STEPS:
                sys.settrace(None)
                return None

            if frame.f_code.co_filename != '<program>':
                return None

            line = frame.f_lineno
            func = frame.f_code.co_name
            fid = id(frame)
            display_name = 'main' if func == '<module>' else func

            if event == 'call':
                prev = {}
                frame_prev[fid] = prev
                variables = _snapshot(frame.f_locals, prev)
                call_stack.append({
                    'function': display_name,
                    'line': line,
                    'variables': variables,
                })
                if func != '<module>':
                    args_desc = ', '.join(
                        f'{k}={v!r}'
                        for k, v in frame.f_locals.items()
                        if not k.startswith('_') and k not in _SKIP_NAMES
                    )
                    _emit(line,
                          f'{func}({args_desc}) called',
                          {'type': 'call', 'function': func})
                return tracer

            if event == 'line':
                if not call_stack:
                    return tracer
                prev = frame_prev.get(fid, {})
                variables = _snapshot(frame.f_locals, prev)
                # Store memtrace snapshot for next diff (copy values for 1D/2D detection)
                frame_prev[fid] = {
                    k: {'kind': v['kind'],
                        'values': copy.deepcopy(v.get('values', [])),
                        'rows': v.get('rows'), 'cols': v.get('cols')}
                    if v['kind'] == 'array' else v
                    for k, v in variables.items()
                }
                call_stack[-1]['line'] = line
                call_stack[-1]['variables'] = variables
                _emit(line, self._src_line(line),
                      {'type': 'assign', 'target': '', 'value': ''})
                return tracer

            if event == 'return':
                if not call_stack:
                    return tracer
                prev = frame_prev.get(fid, {})
                variables = _snapshot(frame.f_locals, prev)
                call_stack[-1]['variables'] = variables
                call_stack[-1]['line'] = line
                ret_str = repr(arg) if arg is not None else 'None'
                if func != '<module>':
                    _emit(line,
                          f'{func}() → {ret_str}',
                          {'type': 'return', 'function': func, 'value': ret_str})
                call_stack.pop()
                frame_prev.pop(fid, None)
                return tracer

            if event == 'exception':
                exc_type, exc_val, _ = arg
                msg = f'{exc_type.__name__}: {exc_val}'
                _emit(line, f'Exception: {msg}',
                      {'type': 'crash', 'kind': 'null-deref', 'message': msg})
                return tracer

            return tracer

        sys.settrace(tracer)
        try:
            exec(  # noqa: S102
                compile(self.source, '<program>', 'exec'),
                {'__name__': '__main__',
                 'input': lambda *_: '1',
                 'print': lambda *_, **__: None},
            )
        except SystemExit:
            pass
        except Exception as e:
            last_line = trace[-1]['line'] if trace else 1
            msg = f'{type(e).__name__}: {e}'
            snapshot = {
                'stack': [copy.deepcopy(sf) for sf in call_stack],
                'heap': {}
            }
            trace.append({
                'index': len(trace),
                'line': last_line,
                'description': f'Error: {msg}',
                'event': {'type': 'crash', 'kind': 'null-deref', 'message': msg},
                'memory': snapshot,
            })
        finally:
            sys.settrace(None)

        if not trace:
            trace.append({
                'index': 0, 'line': 1,
                'description': 'Program executed (no steps traced).',
                'event': {'type': 'end', 'leaks': []},
                'memory': {'stack': [], 'heap': {}},
            })
        else:
            trace.append({
                'index': len(trace),
                'line': trace[-1]['line'],
                'description': 'Program complete.',
                'event': {'type': 'end', 'leaks': []},
                'memory': {'stack': [], 'heap': {}},
            })

        return trace
