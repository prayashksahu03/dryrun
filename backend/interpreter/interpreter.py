from __future__ import annotations
import copy
import pycparser
from .memory import Memory, _reset_addr
from .errors import ReturnException, BreakException, ContinueException, SegFaultError

# One-line fake libc so offset is always exactly 1
FAKE_LIBC = (
    "typedef unsigned int size_t;"
    "void *malloc(size_t s);"
    "void free(void *p);"
    "int printf(const char *f,...);"
    "void *calloc(size_t n,size_t s);"
    "void *realloc(void *p,size_t s);"
    "int __min(int a,int b);"
    "int __max(int a,int b);"
    "int __abs(int a);"
    "\n"
)
LINE_OFFSET = 1   # FAKE_LIBC is exactly 1 line


class CInterpreter:
    def __init__(self, source: str):
        self.source = source
        self.struct_defs: dict = {}     # name -> {field: type_str}
        self.func_defs: dict = {}       # name -> FuncDef node
        self.var_types: dict = {}       # var name -> type_str
        self.trace: list = []
        self.step_count = 0
        self.MAX_STEPS = 2000
        self.memory: Memory = None  # type: ignore

    # ── Public entry point ─────────────────────────────────────────────

    def run(self) -> list:
        _reset_addr()

        cleaned = self._preprocess(self.source)
        full_src = FAKE_LIBC + cleaned

        try:
            ast = pycparser.CParser().parse(full_src, filename='<input>')
        except Exception as e:
            raise ValueError(f"Parse error: {e}")

        self._collect_toplevel(ast)
        self._validate(ast)

        if 'main' not in self.func_defs:
            raise ValueError("No main() function found. Make sure your program has int main() { ... }")

        self.memory = Memory(self.struct_defs)
        self.memory.push_frame('main', 1)
        self._emit(1, 'Program starts. main() is pushed onto the call stack.', {'type': 'start'})

        try:
            self._exec_compound(self.func_defs['main'].body)
        except SegFaultError as e:
            ln = self._adj(e.line or -1)
            self.memory.update_line(ln)
            self.trace.append({
                'index': len(self.trace),
                'line': ln,
                'description': e.message,
                'event': {
                    'type': 'crash',
                    'kind': e.kind,
                    'address': e.address,
                    'message': e.message,
                },
                'memory': self.memory.snapshot(),
            })
        except ReturnException:
            pass

        leaks = [a for a, b in self.memory.heap.items() if b['state'] == 'allocated']
        if leaks:
            desc = f"Program ends. {len(leaks)} memory leak(s): {', '.join(leaks)}"
        else:
            desc = "Program ends cleanly. No memory leaks detected."
        self._emit(-1, desc, {'type': 'end', 'leaks': leaks})

        return self.trace

    # ── Preprocessing ──────────────────────────────────────────────────

    def _preprocess(self, source: str) -> str:
        """Remove #include lines (we handle stdlib ourselves), preserve line numbers."""
        lines = source.split('\n')
        result = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith('#include') or stripped.startswith('#pragma'):
                result.append('')   # blank line preserves line numbers
            else:
                result.append(line)
        return '\n'.join(result)

    # ── AST collection pass ────────────────────────────────────────────

    def _collect_toplevel(self, ast):
        for node in ast.ext:
            nt = type(node).__name__
            if nt == 'FuncDef':
                name = node.decl.name
                if name not in ('malloc', 'free', 'printf', 'calloc', 'realloc'):
                    self.func_defs[name] = node
            elif nt == 'Decl':
                self._try_register_struct(node)

    def _validate(self, ast):
        """
        Strict pre-execution validation pass.
        Raises ValueError with a clear, actionable message for anything
        that would be a compile-time error in real C.
        Never guesses or infers — if something is wrong, say so exactly.
        """
        errors = []
        seen_struct_errors: set = set()

        def check_type_str(ts: str, line: int, context: str):
            # Extract struct name from type string like 'ptr:struct:Node'
            sname = None
            for prefix in ('ptr:struct:', 'struct:'):
                if ts.startswith(prefix):
                    sname = ts[len(prefix):]
                    break
            if sname and sname not in ('unknown', 'anon') and sname not in self.struct_defs:
                key = sname
                if key not in seen_struct_errors:
                    seen_struct_errors.add(key)
                    errors.append(
                        f"Line {line}: 'struct {sname}' is used in {context} "
                        f"but is never defined.\n"
                        f"Add a definition before your functions:\n"
                        f"  struct {sname} {{\n"
                        f"      int  <field>;          // example int field\n"
                        f"      struct {sname} *next;  // example pointer field\n"
                        f"  }};"
                    )

        def walk(node):
            if node is None: return
            nt = type(node).__name__

            if nt == 'Decl' and node.name:
                ts  = self._type_str(node.type)
                ln  = self._adj(self._coord_line(node))
                check_type_str(ts, ln, f"declaration of '{node.name}'")

            # Check function parameter types too
            if nt == 'FuncDef':
                params = []
                try:
                    args = node.decl.type.args
                    if args: params = args.params or []
                except AttributeError:
                    pass
                for p in params:
                    if p.name:
                        ts = self._type_str(p.type)
                        ln = self._adj(self._coord_line(p))
                        check_type_str(ts, ln, f"parameter '{p.name}'")

            for _, child in node.children():
                walk(child)

        for node in ast.ext:
            walk(node)

        if errors:
            raise ValueError('\n\n'.join(errors))

    def _try_register_struct(self, decl_node):
        t = decl_node.type
        if type(t).__name__ == 'Struct' and t.decls:
            self._register_struct(t)
        elif hasattr(t, 'type') and type(t.type).__name__ == 'Struct' and t.type.decls:
            self._register_struct(t.type)

    def _register_struct(self, struct_node):
        name = struct_node.name
        if not name or not struct_node.decls:
            return
        fields = {}
        for decl in struct_node.decls:
            if decl.name:
                fields[decl.name] = self._type_str(decl.type)
        self.struct_defs[name] = fields

    # ── Type system ────────────────────────────────────────────────────

    def _type_str(self, node) -> str:
        nt = type(node).__name__
        if nt == 'TypeDecl':
            return self._type_str(node.type)
        if nt == 'IdentifierType':
            return ' '.join(node.names)
        if nt == 'PtrDecl':
            inner = self._type_str(node.type)
            return f'ptr:{inner}'
        if nt == 'Struct':
            # Register it inline if it has decls
            if node.decls:
                self._register_struct(node)
            return f'struct:{node.name}' if node.name else 'struct:anon'
        if nt == 'ArrayDecl':
            return f'array:{self._type_str(node.type)}'
        if nt == 'FuncDecl':
            return 'func'
        return 'int'

    def _default_for(self, type_str: str) -> dict:
        words = set(type_str.split())
        if words & {'int', 'unsigned', 'long', 'short', 'float', 'double', 'signed'}:
            return {'kind': 'int', 'value': 0}
        if 'char' in words:
            return {'kind': 'char', 'value': ''}
        # pointer or struct — both get a null pointer default
        return {'kind': 'pointer', 'address': None}

    # ── Statement execution ────────────────────────────────────────────

    def _exec_compound(self, node):
        if node is None:
            return
        for item in (node.block_items or []):
            self._exec_stmt(item)

    def _exec_stmt(self, node):
        if node is None:
            return
        nt = type(node).__name__
        if nt == 'Decl':           self._exec_decl(node)
        elif nt == 'Assignment':   self._exec_assign(node)
        elif nt == 'FuncCall':     self._eval(node)
        elif nt == 'UnaryOp':      self._eval(node)
        elif nt == 'If':           self._exec_if(node)
        elif nt == 'While':        self._exec_while(node)
        elif nt == 'For':          self._exec_for(node)
        elif nt == 'DoWhile':      self._exec_do_while(node)
        elif nt == 'Return':
            val = self._eval(node.expr) if node.expr else None
            raise ReturnException(val)
        elif nt == 'Break':        raise BreakException()
        elif nt == 'Continue':     raise ContinueException()
        elif nt == 'Compound':     self._exec_compound(node)
        elif nt == 'Label':        self._exec_stmt(node.stmt)
        elif nt == 'EmptyStatement': pass

    def _exec_decl(self, node):
        name = node.name
        if name is None:
            self._try_register_struct(node)
            return

        line = self._coord_line(node)
        type_str = self._type_str(node.type)
        self.var_types[name] = type_str

        # ── Array declaration ──────────────────────────────────────────
        if type_str.startswith('array:'):
            value = self._init_array(node.type, node.init)
            self.memory.declare_var(name, value)
            self.memory.update_line(line)
            if value.get('cols') is not None:
                shape = f"[{value['rows']}][{value['cols']}]"
            else:
                shape = f"[{len(value['values'])}]"
            self._emit(line, f"Declare {name}{shape} — all cells initialised to 0.",
                       {'type': 'assign', 'target': name, 'value': shape})
            return

        if node.init:
            value = self._eval(node.init)
        else:
            value = self._default_for(type_str)

        self.memory.declare_var(name, value)
        self.memory.update_line(line)

        self._emit(line,
            f"Declare {name} = {self._fmt(value)}.",
            {'type': 'assign', 'target': name, 'value': self._fmt(value)})

    def _exec_assign(self, node):
        line = self._coord_line(node)
        rval = self._eval(node.rvalue)

        # Compound assignment: +=, -=, *=, /=, %=, &=, |=, ^=, <<=, >>=
        op = getattr(node, 'op', '=')
        if op != '=':
            base_op = op[:-1]
            lval = self._eval(node.lvalue)
            lv, rv = self._to_int(lval), self._to_int(rval)
            result = {
                '+': lv + rv, '-': lv - rv, '*': lv * rv,
                '/': lv // rv if rv != 0 else 0,
                '%': lv % rv if rv != 0 else 0,
                '&': lv & rv, '|': lv | rv, '^': lv ^ rv,
                '<<': lv << (rv % 64), '>>': lv >> (rv % 64),
            }.get(base_op, rv)
            rval = {'kind': 'int', 'value': result}

        ltype = type(node.lvalue).__name__

        if ltype == 'ID':
            vname = node.lvalue.name
            self.memory.set_var(vname, rval)
            self.memory.update_line(line)
            self._emit(line, f"{vname} = {self._fmt(rval)}.",
                {'type': 'assign', 'target': vname, 'value': self._fmt(rval)})

        elif ltype == 'StructRef':
            obj_val = self._eval(node.lvalue.name)
            field = node.lvalue.field.name
            obj_name = self._id_name(node.lvalue.name)
            if node.lvalue.type == '->':
                addr = obj_val.get('address') if isinstance(obj_val, dict) else None
                self.memory.write_field(addr, field, rval, line)
                self.memory.update_line(line)
                self._emit(line, f"{obj_name}->{field} = {self._fmt(rval)}.",
                    {'type': 'assign', 'target': f'{obj_name}->{field}', 'value': self._fmt(rval)})
            else:
                self._emit(line, f"{obj_name}.{field} = {self._fmt(rval)}.",
                    {'type': 'assign', 'target': f'{obj_name}.{field}', 'value': self._fmt(rval)})

        elif ltype == 'UnaryOp' and node.lvalue.op == '*':
            ptr_val = self._eval(node.lvalue.expr)
            addr = ptr_val.get('address') if isinstance(ptr_val, dict) else None
            self.memory.write_via_addr(addr, rval, line)
            ptr_name = self._id_name(node.lvalue.expr)
            self.memory.update_line(line)
            self._emit(line, f"*{ptr_name} = {self._fmt(rval)}.",
                {'type': 'assign', 'target': f'*{ptr_name}', 'value': self._fmt(rval)})

        elif ltype == 'ArrayRef':
            self._exec_array_write(node.lvalue, rval, line)

        return rval

    def _exec_if(self, node):
        cond = self._eval(node.cond)
        if self._truthy(cond):
            self._exec_stmt(node.iftrue)
        elif node.iffalse:
            self._exec_stmt(node.iffalse)

    def _exec_while(self, node):
        iters = 0
        while True:
            cond = self._eval(node.cond)
            if not self._truthy(cond):
                break
            iters += 1
            if iters > 500:
                line = self._coord_line(node)
                raise SegFaultError('stack-overflow',
                    'Loop ran more than 300 iterations — possible infinite loop.', None, line)
            try:
                self._exec_stmt(node.stmt)
            except BreakException:
                break
            except ContinueException:
                continue

    def _exec_for(self, node):
        line = self._coord_line(node)
        if node.init:
            # for (int i = 0; ...) produces a DeclList, not a single Decl
            if type(node.init).__name__ == 'DeclList':
                for decl in node.init.decls:
                    self._exec_decl(decl)
            else:
                self._exec_stmt(node.init)
        iters = 0
        while True:
            if node.cond:
                cond = self._eval(node.cond)
                if not self._truthy(cond):
                    break
            iters += 1
            if iters > 500:
                raise SegFaultError('stack-overflow',
                    'For loop exceeded 300 iterations — possible infinite loop.', None, line)
            try:
                self._exec_stmt(node.stmt)
            except BreakException:
                break
            except ContinueException:
                pass
            if node.next:
                self._eval(node.next)

    def _exec_do_while(self, node):
        iters = 0
        while True:
            try:
                self._exec_stmt(node.stmt)
            except BreakException:
                break
            except ContinueException:
                pass
            cond = self._eval(node.cond)
            if not self._truthy(cond):
                break
            iters += 1
            if iters > 500:
                raise SegFaultError('stack-overflow', 'do-while exceeded 300 iterations.', None, -1)

    # ── Expression evaluation ──────────────────────────────────────────

    def _eval(self, node):
        if node is None:
            return None
        line = self._coord_line(node)
        nt = type(node).__name__

        if nt == 'Constant':
            return self._eval_const(node)

        if nt == 'ID':
            name = node.name
            if name == 'NULL':
                return {'kind': 'pointer', 'address': None}
            return self.memory.get_var(name)

        if nt == 'UnaryOp':
            return self._eval_unary(node, line)

        if nt == 'BinaryOp':
            return self._eval_binary(node)

        if nt == 'StructRef':
            obj_val = self._eval(node.name)
            field = node.field.name
            if node.type == '->':
                addr = obj_val.get('address') if isinstance(obj_val, dict) else None
                return self.memory.read_field(addr, field, line)
            elif isinstance(obj_val, dict) and obj_val.get('kind') == 'struct':
                return obj_val['fields'].get(field, {'kind': 'int', 'value': 0})
            return {'kind': 'int', 'value': 0}

        if nt == 'ArrayRef':
            return self._eval_array_ref(node)

        if nt == 'FuncCall':
            return self._eval_call(node, line)

        if nt == 'Assignment':
            return self._exec_assign(node)

        if nt == 'Cast':
            return self._eval(node.expr)

        if nt == 'TernaryOp':
            cond = self._eval(node.cond)
            return self._eval(node.iftrue) if self._truthy(cond) else self._eval(node.iffalse)

        if nt == 'ExprList':
            result = None
            for e in node.exprs:
                result = self._eval(e)
            return result

        return {'kind': 'int', 'value': 0}

    def _eval_const(self, node) -> dict:
        val = node.value
        if node.type == 'int':
            return {'kind': 'int', 'value': int(val.rstrip('uUlL'), 0)}
        if node.type == 'char':
            inner = val.strip("'")
            if inner.startswith('\\'):
                escapes = {'\\n': '\n', '\\t': '\t', '\\0': '\0', '\\\\': '\\', "\\'": "'"}
                inner = escapes.get(inner, inner[1:])
            return {'kind': 'char', 'value': inner}
        if node.type == 'string':
            return {'kind': 'pointer', 'address': None}  # string literals as null for now
        return {'kind': 'int', 'value': 0}

    def _eval_unary(self, node, line: int) -> dict:
        op = node.op
        if op == 'sizeof':
            # Return size as int
            inner = node.expr
            if type(inner).__name__ == 'Typename':
                ts = self._type_str(inner.type)
                sz = self.memory._sizeof(ts.replace('ptr:', '').replace('struct:', ''))
                return {'kind': 'int', 'value': sz}
            return {'kind': 'int', 'value': 8}

        if op == '*':
            ptr_val = self._eval(node.expr)
            if not isinstance(ptr_val, dict) or ptr_val.get('kind') != 'pointer':
                raise SegFaultError('segfault', 'Dereferencing a non-pointer value.', None, line)
            addr = ptr_val.get('address')
            # read_via_addr handles both stack addresses (&var) and heap addresses
            return self.memory.read_via_addr(addr, line)

        if op == '&':
            if type(node.expr).__name__ == 'ID':
                name = node.expr.name
                try:
                    addr = self.memory.addr_of_var(name)
                    return {'kind': 'pointer', 'address': addr}
                except RuntimeError:
                    return {'kind': 'pointer', 'address': None}
            return {'kind': 'pointer', 'address': None}

        if op == '!':
            return {'kind': 'int', 'value': int(not self._truthy(self._eval(node.expr)))}

        if op == '-':
            v = self._eval(node.expr)
            return {'kind': 'int', 'value': -self._to_int(v)}

        if op == '~':
            v = self._eval(node.expr)
            return {'kind': 'int', 'value': ~self._to_int(v)}

        if op in ('p++', 'p--', '++', '--'):
            val = self._eval(node.expr)
            delta = 1 if op in ('p++', '++') else -1
            new_val = {'kind': 'int', 'value': self._to_int(val) + delta}
            if type(node.expr).__name__ == 'ID':
                self.memory.set_var(node.expr.name, new_val)
            return val if op in ('p++', 'p--') else new_val

        return {'kind': 'int', 'value': 0}

    def _eval_binary(self, node) -> dict:
        op = node.op
        # Short-circuit logical ops
        if op == '&&':
            l = self._eval(node.left)
            if not self._truthy(l): return {'kind': 'int', 'value': 0}
            r = self._eval(node.right)
            return {'kind': 'int', 'value': int(self._truthy(r))}
        if op == '||':
            l = self._eval(node.left)
            if self._truthy(l): return {'kind': 'int', 'value': 1}
            r = self._eval(node.right)
            return {'kind': 'int', 'value': int(self._truthy(r))}

        l = self._eval(node.left)
        r = self._eval(node.right)
        lv, rv = self._to_int(l), self._to_int(r)

        ops = {
            '+': lv + rv, '-': lv - rv, '*': lv * rv,
            '/': lv // rv if rv != 0 else 0,
            '%': lv % rv if rv != 0 else 0,
            '==': int(lv == rv), '!=': int(lv != rv),
            '<':  int(lv < rv),  '>':  int(lv > rv),
            '<=': int(lv <= rv), '>=': int(lv >= rv),
            '&': lv & rv, '|': lv | rv, '^': lv ^ rv,
            '<<': lv << (rv % 32), '>>': lv >> (rv % 32),
        }
        return {'kind': 'int', 'value': ops.get(op, 0)}

    def _eval_call(self, node, line: int):
        func_name = None
        if type(node.name).__name__ == 'ID':
            func_name = node.name.name

        args = [self._eval(a) for a in (node.args.exprs if node.args else [])]

        # ── stdlib ──────────────────────────────────────────────
        if func_name == 'malloc':
            struct_name = self._infer_malloc_type(node)
            addr = self.memory.malloc(struct_name, line)
            block = self.memory.heap[addr]
            self.memory.update_line(line)
            self._emit(line,
                f"malloc({block['size']}B) allocates a {struct_name} on the heap → {addr}.",
                {'type': 'malloc', 'address': addr, 'size': block['size'], 'typeName': struct_name})
            return {'kind': 'pointer', 'address': addr}

        if func_name == 'calloc':
            struct_name = self._infer_malloc_type(node)
            addr = self.memory.malloc(struct_name, line)
            block = self.memory.heap[addr]
            self._emit(line,
                f"calloc allocates zeroed {struct_name} → {addr}.",
                {'type': 'malloc', 'address': addr, 'size': block['size'], 'typeName': struct_name})
            return {'kind': 'pointer', 'address': addr}

        if func_name == 'free':
            addr_val = args[0] if args else {'kind': 'pointer', 'address': None}
            addr = addr_val.get('address') if isinstance(addr_val, dict) else None
            self.memory.free(addr, line)
            self.memory.update_line(line)
            self._emit(line,
                f"free({addr}) — block released. Any pointer still holding {addr} is now dangling.",
                {'type': 'free', 'address': addr})
            return None

        if func_name == 'exit':
            raise ReturnException(args[0] if args else None)

        if func_name in ('printf', 'puts', 'putchar', 'fprintf', 'sprintf',
                         'scanf', 'fscanf', 'sscanf', 'gets', 'fgets'):
            return {'kind': 'int', 'value': 0}

        if func_name == '__min' and len(args) >= 2:
            return {'kind': 'int', 'value': min(self._to_int(args[0]), self._to_int(args[1]))}
        if func_name == '__max' and len(args) >= 2:
            return {'kind': 'int', 'value': max(self._to_int(args[0]), self._to_int(args[1]))}
        if func_name == '__abs' and len(args) >= 1:
            return {'kind': 'int', 'value': abs(self._to_int(args[0]))}

        if func_name in ('malloc', 'realloc'):
            return {'kind': 'pointer', 'address': None}

        # ── user-defined function ────────────────────────────────
        if func_name and func_name in self.func_defs:
            fn_node = self.func_defs[func_name]
            self.memory.update_line(line)
            self._emit(line, f"Calling {func_name}().",
                {'type': 'call', 'function': func_name})
            self.memory.push_frame(func_name, line)

            # Bind parameters
            params = []
            if fn_node.decl.type.args:
                params = fn_node.decl.type.args.params or []
            for param, arg_val in zip(params, args):
                if param.name:
                    self.memory.declare_var(param.name, arg_val)
                    self.var_types[param.name] = self._type_str(param.type)

            ret_val = None
            try:
                self._exec_compound(fn_node.body)
            except ReturnException as r:
                ret_val = r.value

            self.memory.pop_frame()
            self._emit(line, f"Returning from {func_name}().",
                {'type': 'return', 'function': func_name,
                 'value': self._fmt(ret_val) if ret_val is not None else 'void'})
            return ret_val

        return {'kind': 'int', 'value': 0}

    # ── Array support ──────────────────────────────────────────────────

    def _init_array(self, type_node, init_node) -> dict:
        """Build the initial array value from an ArrayDecl node."""
        if type(type_node).__name__ != 'ArrayDecl':
            return {'kind': 'array', 'values': []}

        inner = type_node.type
        is_2d = type(inner).__name__ == 'ArrayDecl'

        if is_2d:
            rows = self._to_int(self._eval(type_node.dim)) if type_node.dim else 0
            cols = self._to_int(self._eval(inner.dim)) if inner.dim else 0
            if init_node and type(init_node).__name__ == 'InitList':
                values = []
                for row_expr in init_node.exprs:
                    if type(row_expr).__name__ == 'InitList':
                        row = [(self._to_int(self._eval(e))) for e in row_expr.exprs]
                    else:
                        row = [self._to_int(self._eval(row_expr))]
                    row = (row + [0] * cols)[:cols]
                    values.append(row)
                while len(values) < rows:
                    values.append([0] * cols)
                values = values[:rows]
            else:
                values = [[0] * cols for _ in range(rows)]
            return {'kind': 'array', 'values': values, 'rows': rows, 'cols': cols}
        else:
            size = self._to_int(self._eval(type_node.dim)) if type_node.dim else 0
            if init_node and type(init_node).__name__ == 'InitList':
                vals = [self._to_int(self._eval(e)) for e in init_node.exprs]
                if size == 0:
                    size = len(vals)
                vals = (vals + [0] * size)[:size]
            else:
                vals = [0] * size
            return {'kind': 'array', 'values': vals}

    def _eval_array_ref(self, node) -> dict:
        """Evaluate arr[i] or dp[i][j] — returns the element value."""
        idx = self._to_int(self._eval(node.subscript))
        inner = node.name

        if type(inner).__name__ == 'ArrayRef':
            # 2D: dp[i][j]
            row = self._to_int(self._eval(inner.subscript))
            arr = self.memory.get_var(inner.name.name)
        else:
            # 1D: arr[i]
            arr = self.memory.get_var(inner.name)
            row = None

        if not isinstance(arr, dict) or arr.get('kind') != 'array':
            return {'kind': 'int', 'value': 0}

        vals = arr['values']
        try:
            if row is not None:
                cell = vals[row][idx]
            else:
                cell = vals[idx]
            return {'kind': 'int', 'value': int(cell)}
        except (IndexError, TypeError):
            return {'kind': 'int', 'value': 0}

    def _exec_array_write(self, lv_node, rval, line: int):
        """Write arr[i]=val or dp[i][j]=val and emit an assign event."""
        idx = self._to_int(self._eval(lv_node.subscript))
        inner = lv_node.name

        if type(inner).__name__ == 'ArrayRef':
            # 2D
            row = self._to_int(self._eval(inner.subscript))
            arr_name = inner.name.name
            arr = self.memory.get_var(arr_name)
            if isinstance(arr, dict) and arr.get('kind') == 'array':
                arr['values'][row][idx] = self._to_int(rval)
                arr['lastWrite'] = [row, idx]
                self.memory.set_var(arr_name, arr)
            self.memory.update_line(line)
            self._emit(line, f"{arr_name}[{row}][{idx}] = {self._to_int(rval)}.",
                       {'type': 'assign', 'target': f'{arr_name}[{row}][{idx}]',
                        'value': str(self._to_int(rval))})
        else:
            # 1D
            arr_name = inner.name
            arr = self.memory.get_var(arr_name)
            if isinstance(arr, dict) and arr.get('kind') == 'array':
                arr['values'][idx] = self._to_int(rval)
                arr['lastWrite'] = [idx]
                self.memory.set_var(arr_name, arr)
            self.memory.update_line(line)
            self._emit(line, f"{arr_name}[{idx}] = {self._to_int(rval)}.",
                       {'type': 'assign', 'target': f'{arr_name}[{idx}]',
                        'value': str(self._to_int(rval))})

    # ── Malloc type inference ──────────────────────────────────────────

    def _infer_malloc_type(self, call_node) -> str:
        """Infer struct name from sizeof(struct Foo) argument."""
        if not call_node.args or not call_node.args.exprs:
            return 'unknown'
        arg = call_node.args.exprs[0]
        if type(arg).__name__ == 'UnaryOp' and arg.op == 'sizeof':
            inner = arg.expr
            if type(inner).__name__ == 'Typename':
                ts = self._type_str(inner.type)
                # 'struct:Node' -> 'Node', 'ptr:struct:Node' -> 'Node'
                for part in ts.split(':'):
                    if part and part not in ('ptr', 'struct', 'array'):
                        if part in self.struct_defs:
                            return part
                        return part
            elif type(inner).__name__ == 'ID':
                return inner.name
        # Fallback: check all known structs, pick first (rough heuristic)
        if self.struct_defs:
            return next(iter(self.struct_defs))
        return 'unknown'

    # ── Utilities ──────────────────────────────────────────────────────

    def _emit(self, line: int, description: str, event: dict):
        self.step_count += 1
        if self.step_count > self.MAX_STEPS:
            raise SegFaultError('stack-overflow',
                f'Exceeded {self.MAX_STEPS} execution steps — likely an infinite loop.', None, line)
        adj = self._adj(line)
        self.trace.append({
            'index': len(self.trace),
            'line': adj,
            'description': description,
            'event': event,
            'memory': self.memory.snapshot(),
        })

    def _adj(self, line: int) -> int:
        """Adjust raw pycparser line to user source line."""
        if line < 0:
            return line
        return max(1, line - LINE_OFFSET)

    def _coord_line(self, node) -> int:
        coord = getattr(node, 'coord', None)
        return getattr(coord, 'line', -1) or -1

    def _truthy(self, val) -> bool:
        if val is None: return False
        if isinstance(val, dict):
            k = val.get('kind')
            if k == 'int':     return val.get('value', 0) != 0
            if k == 'pointer': return val.get('address') is not None
            if k == 'char':    return val.get('value', '') not in ('', '\0')
        return bool(val)

    def _to_int(self, val) -> int:
        if val is None: return 0
        if isinstance(val, dict):
            k = val.get('kind')
            if k == 'int':     return val.get('value', 0)
            if k == 'pointer': return 0 if val.get('address') is None else 1
            if k == 'char':    return ord(val['value']) if val.get('value') else 0
        return 0

    def _fmt(self, val) -> str:
        if val is None: return 'void'
        if isinstance(val, dict):
            k = val.get('kind')
            if k == 'int':     return str(val.get('value', 0))
            if k == 'pointer': return val.get('address') or 'NULL'
            if k == 'char':    return f"'{val.get('value', '')}'"
        return str(val)

    def _id_name(self, node) -> str:
        nt = type(node).__name__
        if nt == 'ID': return node.name
        if nt == 'StructRef':
            return f'{self._id_name(node.name)}{node.type}{node.field.name}'
        return '?'
