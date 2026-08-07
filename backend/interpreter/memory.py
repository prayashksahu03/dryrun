import copy
import itertools

_addr_counter  = itertools.count(0x1040, step=0x10)
_stack_counter = itertools.count(0x8000, step=0x08)

def _new_addr() -> str:
    return f"0x{next(_addr_counter):04x}"

def _new_stack_addr() -> str:
    return f"0x{next(_stack_counter):04x}"

def _reset_addr():
    global _addr_counter, _stack_counter
    _addr_counter  = itertools.count(0x1040, step=0x10)
    _stack_counter = itertools.count(0x8000, step=0x08)


class Memory:
    def __init__(self, struct_defs: dict):
        self.struct_defs = struct_defs
        self.heap: dict  = {}    # addr -> block dict
        self.stack: list = []    # list of frame dicts

        # Stack variable addressing (for & operator)
        self._var_addr:  dict = {}   # (depth, name) -> stack_addr
        self._addr_var:  dict = {}   # stack_addr -> (depth, name)

        # Object identity (TRACE_CONTRACT_v2, LAW 1). oid is owned by the storage
        # object, minted once at birth, never by the value. Single source of truth.
        self._oid_seq: int = 0

    def mint_oid(self) -> str:
        self._oid_seq += 1
        return f'o{self._oid_seq}'

    def slot_oid(self, name: str) -> str:
        """The storage identity of the nearest in-scope variable named `name`."""
        for frame in reversed(self.stack):
            oids = frame.get('_oids')
            if oids and name in oids:
                return oids[name]
        if self.stack:  # backstop: mint on the top frame (should be rare)
            return self.stack[-1].setdefault('_oids', {}).setdefault(name, self.mint_oid())
        return self.mint_oid()

    # ── Stack frames ───────────────────────────────────────────────────

    def push_frame(self, func_name: str, line: int):
        # A call activation is itself a runtime object — mint its identity at
        # birth so the frontend can tell two invocations of the same function
        # apart (sibling calls must not "morph" into each other).
        self.stack.append({'function': func_name, 'line': line,
                           'variables': {}, '_oids': {}, 'oid': self.mint_oid()})

    def pop_frame(self):
        if self.stack:
            # Invalidate all stack addresses for this frame
            depth = len(self.stack) - 1
            stale = [k for k in self._var_addr if k[0] == depth]
            for k in stale:
                addr = self._var_addr.pop(k)
                self._addr_var.pop(addr, None)
            return self.stack.pop()

    def set_var(self, name: str, value):
        for frame in reversed(self.stack):
            if name in frame['variables']:
                frame['variables'][name] = value
                return
        if self.stack:
            self.stack[-1]['variables'][name] = value

    def get_var(self, name: str):
        for frame in reversed(self.stack):
            if name in frame['variables']:
                return frame['variables'][name]
        raise RuntimeError(f"Undefined variable: '{name}'")

    def declare_var(self, name: str, value):
        if self.stack:
            self.stack[-1]['variables'][name] = value
            # Mint the storage object's identity at birth (declaration). The oid
            # lives on the slot, not the value, so mutation never changes it.
            oids = self.stack[-1].setdefault('_oids', {})
            if name not in oids:
                oids[name] = self.mint_oid()

    def update_line(self, line: int):
        if self.stack:
            self.stack[-1]['line'] = line

    # ── Stack variable addressing (&var) ───────────────────────────────

    def addr_of_var(self, name: str) -> str:
        """Return a stable pseudo-address for a stack variable (& operator)."""
        for depth, frame in enumerate(self.stack):
            if name in frame['variables']:
                key = (depth, name)
                if key not in self._var_addr:
                    addr = _new_stack_addr()
                    self._var_addr[key] = addr
                    self._addr_var[addr] = key
                return self._var_addr[key]
        raise RuntimeError(f"Cannot take address of undefined variable '{name}'")

    def is_stack_addr(self, addr: str) -> bool:
        return addr in self._addr_var

    def read_via_addr(self, addr, line: int):
        """
        Dereference any address — stack variable or heap block.
        Used by *ptr evaluation.
        """
        from .errors import SegFaultError
        if addr is None:
            raise SegFaultError('null-deref', 'Null pointer dereference.', None, line)

        # Stack variable address (&var)
        if addr in self._addr_var:
            depth, name = self._addr_var[addr]
            if depth < len(self.stack) and name in self.stack[depth]['variables']:
                return copy.deepcopy(self.stack[depth]['variables'][name])
            raise SegFaultError('segfault',
                f'Stack address {addr} is no longer valid — variable went out of scope.', addr, line)

        # Heap address
        block = self.read_ptr(addr, line)
        fields = block['fields']
        if len(fields) == 1:
            return copy.deepcopy(list(fields.values())[0])
        return {'kind': 'struct', 'fields': copy.deepcopy(fields)}

    def write_via_addr(self, addr, value, line: int):
        """
        Write through any address — stack variable or heap block.
        Used by *ptr = value assignment.
        """
        from .errors import SegFaultError
        if addr is None:
            raise SegFaultError('null-deref', 'Null pointer dereference in write.', None, line)

        # Stack variable address
        if addr in self._addr_var:
            depth, name = self._addr_var[addr]
            if depth < len(self.stack) and name in self.stack[depth]['variables']:
                self.stack[depth]['variables'][name] = value
                return
            raise SegFaultError('segfault',
                f'Stack address {addr} is out of scope.', addr, line)

        # Heap address — write to single-field block
        self.write_field(addr, list(self.heap[addr]['fields'].keys())[0]
                         if addr in self.heap and self.heap[addr]['fields']
                         else 'value', value, line)

    # ── Heap ───────────────────────────────────────────────────────────

    def malloc(self, struct_name: str, line: int) -> str:
        addr = _new_addr()
        fields = {}
        if struct_name in self.struct_defs:
            for fn, ft in self.struct_defs[struct_name].items():
                fields[fn] = self._default_value(ft)
        else:
            fields = {'value': {'kind': 'int', 'value': 0}}

        self.heap[addr] = {
            'address': addr,
            'size': self._sizeof(struct_name),
            'typeName': struct_name,
            'state': 'allocated',
            'fields': fields,
            'allocatedAtLine': line,
        }
        return addr

    def free(self, addr, line: int):
        from .errors import SegFaultError
        if addr is None:
            raise SegFaultError('null-deref', 'free(NULL) — cannot free a null pointer.', None, line)
        if addr not in self.heap:
            if self.is_stack_addr(addr):
                raise SegFaultError('segfault',
                    f'free() on stack address {addr} — you can only free heap memory.', addr, line)
            raise SegFaultError('segfault', f'free() on invalid address {addr}.', addr, line)
        block = self.heap[addr]
        if block['state'] == 'freed':
            raise SegFaultError('double-free',
                f'double-free of {addr} — already freed at line {block.get("freedAtLine", "?")}.', addr, line)
        block['state'] = 'freed'
        block['freedAtLine'] = line

    def read_ptr(self, addr, line: int) -> dict:
        from .errors import SegFaultError
        if addr is None:
            raise SegFaultError('null-deref', 'Null pointer dereference — dereferencing NULL (0x0000).', '0x0000', line)
        if addr not in self.heap:
            raise SegFaultError('segfault', f'Invalid memory access at {addr} — not a heap address.', addr, line)
        block = self.heap[addr]
        if block['state'] == 'freed':
            raise SegFaultError('use-after-free',
                f'Use-after-free: reading from freed memory at {addr}. '
                f'Released at line {block.get("freedAtLine", "?")}.', addr, line)
        return block

    def read_field(self, addr, field: str, line: int):
        # Stack-allocated struct pointer (&local_var)
        if addr in self._addr_var:
            depth, name = self._addr_var[addr]
            if depth < len(self.stack) and name in self.stack[depth]['variables']:
                obj = self.stack[depth]['variables'][name]
                if isinstance(obj, dict) and obj.get('kind') == 'struct':
                    return copy.deepcopy(obj['fields'].get(field, {'kind': 'int', 'value': 0}))
        block = self.read_ptr(addr, line)
        return copy.deepcopy(block['fields'].get(field, {'kind': 'int', 'value': 0}))

    def write_field(self, addr, field: str, value, line: int):
        # Stack-allocated struct pointer (&local_var)
        if addr in self._addr_var:
            depth, name = self._addr_var[addr]
            if depth < len(self.stack) and name in self.stack[depth]['variables']:
                obj = self.stack[depth]['variables'][name]
                if isinstance(obj, dict) and obj.get('kind') == 'struct':
                    obj['fields'][field] = value
                    return
        block = self.read_ptr(addr, line)
        block['fields'][field] = value

    # ── Helpers ────────────────────────────────────────────────────────

    def _sizeof(self, type_name: str) -> int:
        if type_name in ('int', 'unsigned int', 'long', 'float', 'unsigned'): return 4
        if type_name in ('char', 'unsigned char'): return 1
        if type_name.startswith('ptr:') or type_name == 'pointer': return 8
        if type_name in self.struct_defs:
            total = sum(self._sizeof(ft) for ft in self.struct_defs[type_name].values())
            return total if total else 8
        return 8

    def _default_value(self, type_str: str) -> dict:
        if type_str in ('int', 'unsigned int', 'long', 'unsigned', 'float'):
            return {'kind': 'int', 'value': 0}
        if type_str == 'char':
            return {'kind': 'char', 'value': ''}
        if type_str.startswith('ptr_array:'):
            n = int(type_str.split(':')[1])
            return {'kind': 'array', 'values': [{'kind': 'pointer', 'address': None} for _ in range(n)]}
        return {'kind': 'pointer', 'address': None}

    def snapshot(self) -> dict:
        stack = copy.deepcopy(self.stack)
        # Stamp every serialized variable with its storage object's oid, so the
        # frontend sees stable identity (LAW 1). The private _oids map is not
        # part of the serialized shape, so strip it after stamping.
        for frame in stack:
            oids = frame.pop('_oids', {})
            for nm, val in frame.get('variables', {}).items():
                if isinstance(val, dict) and nm in oids:
                    val['oid'] = oids[nm]
        return {'stack': stack, 'heap': copy.deepcopy(self.heap)}
