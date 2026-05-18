"""
C++ interpreter — Session 1.
Uses libclang (clang.cindex) to parse C++ into a cursor AST, then walks it
interpreting statements and expressions into MemTrace trace steps.

Supports:
  - All primitive types (int, long long, bool, char, float, double)
  - Free functions with recursion
  - Pointers and references (pass-by-ref simplified to pass-by-value for S1)
  - 1-D and 2-D arrays (C-style + vector<T>)
  - Classes: member fields, constructors with initialiser lists, this, method calls
  - new / delete  →  heap blocks
  - Basic vector<T>: push_back, size, resize, empty, clear, back, front, pop_back
  - Adjacency-matrix classes (Graph) used with the frontend GraphViz visualiser
"""
from __future__ import annotations
import copy
import re

try:
    from clang import cindex
    CK = cindex.CursorKind
    TK = cindex.TokenKind
    _LIBCLANG_OK = True
except ImportError:
    _LIBCLANG_OK = False
    CK = None
    TK = None

from .memory import Memory, _reset_addr
from .errors import ReturnException, BreakException, ContinueException, SegFaultError, ThrownException

MAX_STEPS     = 2000
MAX_ITERS     = 120   # iterations before we warn about an infinite loop
MAX_CALL_DEPTH = 40   # user call frames before we emit stack-overflow

class TraceTruncated(Exception):
    """Raised when the trace exceeds MAX_STEPS — not a crash, just too complex."""
    def __init__(self, hint: str = ''):
        self.hint = hint

# Minimal stubs so libclang can parse code that includes <bits/stdc++.h> etc.
# after we strip the real #include lines.
_STUBS = """\
namespace std {
  struct ostream {
    template<typename T> ostream& operator<<(T const&);
    ostream& operator<<(ostream& (*f)(ostream&));
  };
  struct istream {
    template<typename T> istream& operator>>(T&);
  };
  extern ostream cout;
  extern ostream cerr;
  extern istream cin;
  ostream& endl(ostream&);
  ostream& flush(ostream&);
  template<typename T> class initializer_list {
  public:
    struct iterator { T const& operator*(); iterator& operator++(); bool operator!=(iterator) const; };
    iterator begin() const; iterator end() const;
    int size() const;
  };
  template<typename T> class vector {
  public:
    typedef int size_type;
    struct iterator { T& operator*(); iterator& operator++(); bool operator!=(iterator); };
    typedef iterator const_iterator;
    vector(); vector(int n); vector(int n, T const& v);
    vector(initializer_list<T>);
    void push_back(T const&);
    size_type size() const;
    bool empty() const;
    void clear();
    void pop_back();
    void resize(int);
    void resize(int, T const&);
    T& back(); T const& back() const;
    T& front(); T const& front() const;
    T& operator[](int);
    T const& operator[](int) const;
    iterator begin(); const_iterator begin() const;
    iterator end();   const_iterator end() const;
  };
  template<typename T> class queue {
  public:
    void push(T const&);
    void pop();
    T& front(); T const& front() const;
    T& back();  T const& back() const;
    bool empty() const;
    int size() const;
  };
  template<typename T> class stack {
  public:
    void push(T const&);
    void pop();
    T& top(); T const& top() const;
    bool empty() const;
    int size() const;
  };
  template<typename T> class deque {
  public:
    struct iterator { T& operator*(); iterator& operator++(); bool operator!=(iterator); };
    void push_back(T const&); void push_front(T const&);
    void pop_back(); void pop_front();
    T& front(); T& back();
    bool empty() const; int size() const;
    T& operator[](int);
    iterator begin(); iterator end();
  };
  template<typename T> struct greater {
    bool operator()(T const& a, T const& b) const;
  };
  template<typename T> struct less {
    bool operator()(T const& a, T const& b) const;
  };
  template<typename T, typename U> struct pair {
    T first; U second;
    pair(); pair(T const& a, U const& b);
    pair(initializer_list<int>);
    bool operator<(pair const&) const;
    bool operator>(pair const&) const;
  };
  template<typename T, typename U> pair<T,U> make_pair(T, U);
  template<typename T,
           typename Container = vector<T>,
           typename Compare = greater<T>> class priority_queue {
  public:
    void push(T const&);
    void pop();
    T const& top() const;
    bool empty() const;
    int size() const;
  };
  template<typename K, typename V> class map {
  public:
    struct iterator { pair<K,V>& operator*(); iterator& operator++(); bool operator!=(iterator) const; };
    map(); map(initializer_list<pair<K,V>>);
    V& operator[](K const&);
    int size() const; bool empty() const;
    int count(K const&) const;
    void erase(K const&);
    iterator begin(); iterator end(); iterator find(K const&);
  };
  template<typename K, typename V> class unordered_map {
  public:
    struct iterator { pair<K,V>& operator*(); iterator& operator++(); bool operator!=(iterator) const; };
    unordered_map(); unordered_map(initializer_list<pair<K,V>>);
    V& operator[](K const&);
    int size() const; bool empty() const;
    int count(K const&) const;
    void erase(K const&);
    iterator begin(); iterator end(); iterator find(K const&);
  };
  template<typename K> class set {
  public:
    struct iterator { K const& operator*(); iterator& operator++(); bool operator!=(iterator) const; };
    set(); set(initializer_list<K>);
    void insert(K const&);
    void erase(K const&);
    int count(K const&) const;
    int size() const; bool empty() const;
    iterator begin(); iterator end(); iterator find(K const&);
  };
  template<typename K> class multiset {
  public:
    struct iterator { K const& operator*(); iterator& operator++(); bool operator!=(iterator) const; };
    typedef iterator reverse_iterator;
    multiset(); multiset(iterator, iterator);
    void insert(K const&);
    void erase(iterator);
    void erase(K const&);
    int count(K const&) const;
    int size() const; bool empty() const;
    iterator begin(); iterator end(); iterator find(K const&);
    reverse_iterator rbegin(); reverse_iterator rend();
  };
  template<typename K> class unordered_set {
  public:
    struct iterator { K const& operator*(); iterator& operator++(); bool operator!=(iterator) const; };
    unordered_set();
    void insert(K const&);
    void erase(K const&);
    int count(K const&) const;
    int size() const; bool empty() const;
    iterator begin(); iterator end();
  };
  template<typename T> T min(T a, T b);
  template<typename T> T max(T a, T b);
  template<typename T> T min(initializer_list<T>);
  template<typename T> T max(initializer_list<T>);
  template<typename T> T abs(T a);
  template<typename T> void sort(T*, T*);
  template<typename It> void sort(It, It);
  template<typename It, typename Cmp> void sort(It, It, Cmp);
  template<typename It> void reverse(It, It);
  template<typename It, typename T> It lower_bound(It, It, T const&);
  template<typename It, typename T> It upper_bound(It, It, T const&);
  template<typename It> It max_element(It, It);
  template<typename It> It min_element(It, It);
  template<typename It, typename T> T accumulate(It, It, T);
  template<typename T> void swap(T&, T&);
  struct string {
    struct iterator { char& operator*(); iterator& operator++(); bool operator!=(iterator) const; };
    string(); string(char const*); string(int n, char c);
    int size() const; int length() const; bool empty() const;
    char& operator[](int); char const& operator[](int) const;
    char& at(int); char const& at(int) const;
    char& back(); char const& back() const;
    char& front(); char const& front() const;
    void push_back(char); void pop_back();
    string substr(int pos, int len) const; string substr(int pos) const;
    int find(char const*) const; int find(string const&) const; int find(char) const;
    string& erase(int pos, int len); string& erase(int pos);
    string& insert(int pos, string const&); string& insert(int pos, char const*);
    string operator+(string const&) const; string operator+(char const*) const;
    string& operator+=(string const&); string& operator+=(char);
    bool operator==(string const&) const; bool operator!=(string const&) const;
    bool operator<(string const&) const; bool operator>(string const&) const;
    bool operator<=(string const&) const; bool operator>=(string const&) const;
    iterator begin(); iterator end();
    static const int npos = -1;
  };
  int stoi(string const&);
  string to_string(int); string to_string(long long);
  int isdigit(int); int isalpha(int); int isspace(int); int ispunct(int);
  int isupper(int); int islower(int); int isalnum(int);
  int toupper(int); int tolower(int);
  template<typename T> T gcd(T a, T b);
  template<typename T> T lcm(T a, T b);
  struct _Setw { int n; };
  struct _Setfill { char c; };
  struct _Setprecision { int n; };
  _Setw setw(int n);
  _Setfill setfill(char c);
  _Setprecision setprecision(int n);
  ostream& operator<<(ostream&, _Setw);
  ostream& operator<<(ostream&, _Setfill);
  ostream& operator<<(ostream&, _Setprecision);
  ostream& hex(ostream&);
  ostream& dec(ostream&);
  ostream& fixed(ostream&);
  ostream& scientific(ostream&);
  template<typename It, typename T> void fill(It first, It last, T const& val);
  template<typename It, typename T> void iota(It first, It last, T val);
  template<typename It, typename T> int count(It first, It last, T const& val);
  template<typename It> bool next_permutation(It first, It last);
  template<typename It> bool prev_permutation(It first, It last);
  template<typename It> void make_heap(It first, It last);
  template<typename It> void push_heap(It first, It last);
  template<typename It> void pop_heap(It first, It last);
  template<typename It, typename T> bool binary_search(It first, It last, T const& val);
  template<typename It> It rotate(It first, It middle, It last);
  template<typename It> It unique(It first, It last);
  template<typename It1, typename It2> long long distance(It1 first, It2 last);
  template<typename It> void advance(It& it, long long n);
  template<typename It, typename F> It find_if(It first, It last, F pred);
  template<typename It, typename F> It find_if_not(It first, It last, F pred);
  template<typename It, typename F> long long count_if(It first, It last, F pred);
  template<typename It, typename F> bool any_of(It first, It last, F pred);
  template<typename It, typename F> bool all_of(It first, It last, F pred);
  template<typename It, typename F> bool none_of(It first, It last, F pred);
  template<typename It, typename Out, typename F> Out transform(It first, It last, Out out, F op);
  template<typename It, typename Out> Out copy(It first, It last, Out out);
  typedef long long ll;
}
using namespace std;
#define NULL 0
typedef long long ll;
typedef unsigned long long ull;
const int INT_MAX = 2147483647;
const int INT_MIN = -2147483648;
const long long LLONG_MAX = 9223372036854775807LL;
const long long LLONG_MIN = -9223372036854775807LL - 1;
const long long LONG_MAX  = 9223372036854775807LL;
const int       LONG_MIN  = -2147483648;
int printf(const char* fmt, ...);
int scanf(const char* fmt, ...);
void* malloc(unsigned long size);
void* calloc(unsigned long count, unsigned long size);
void* realloc(void* ptr, unsigned long size);
void  free(void* ptr);
void  assert(int cond);
unsigned long strlen(const char* s);
char* strcpy(char* dst, const char* src);
char* strcat(char* dst, const char* src);
int   strcmp(const char* a, const char* b);
void* memset(void* ptr, int val, unsigned long n);
void* memcpy(void* dst, const void* src, unsigned long n);
int   atoi(const char* s);
int __builtin_popcount(unsigned int x);
int __builtin_clz(unsigned int x);
int __builtin_ctz(unsigned int x);
int __gcd(int a, int b);
double sqrt(double x);
double floor(double x);
double ceil(double x);
double round(double x);
double fabs(double x);
double pow(double x, double y);
double log(double x);
double log2(double x);
double log10(double x);
double exp(double x);
double sin(double x);
double cos(double x);
double tan(double x);
double asin(double x);
double acos(double x);
double atan(double x);
double atan2(double y, double x);
double fmod(double x, double y);
int rand();
void srand(unsigned int seed);
int time(int* t);
"""
_STUBS_LINES = _STUBS.count('\n')   # stubs end with \n; body starts on the next line


class _ThisBinding:
    __slots__ = ('kind', 'frame_idx', 'var_name', 'addr', 'class_name')

    def __init__(self, kind: str, **kw):
        self.kind       = kind
        self.frame_idx  = kw.get('frame_idx')
        self.var_name   = kw.get('var_name')
        self.addr       = kw.get('addr')
        self.class_name = kw.get('class_name', '')  # explicit class name avoids field inference


class CppInterpreter:
    def __init__(self, source: str, stdin_data: str = ""):
        if not _LIBCLANG_OK:
            raise ValueError(
                "libclang is not installed. Run: pip install libclang"
            )
        self.source        = source
        self.source_bytes  = source.encode('utf-8')
        self.source_lines  = source.split('\n')

        self.func_defs:    dict = {}   # name  -> cursor
        self.class_defs:   dict = {}   # name  -> { fields, ctors, methods }
        self.enum_constants: dict = {} # EAST/NORTH/etc -> int value
        self._global_var_cursors: list = []   # global VAR_DECL cursors
        self._lambda_store: dict = {}          # variable name -> LAMBDA_EXPR cursor

        self.memory:       Memory = None   # type: ignore
        self.trace:        list   = []
        self.step_count:   int    = 0
        self._line_offset: int    = 0
        self._this_stack:  list   = []    # stack of _ThisBinding

        self._stdin_tokens: list = stdin_data.split() if stdin_data and stdin_data.strip() else []
        self._stdin_pos:    int  = 0

        # Heuristic detection state
        self._queue_push_log: dict = {}   # queue_name -> list of int values pushed (#7/#21)
        self._iter_sources:   dict = {}   # iter_var_name -> container_name (#14)
        self._vec_buf_addrs:  dict = {}   # var_name -> current fake buffer addr
        self._vec_iter_vars:  dict = {}   # range_name -> synthetic iter var name in frame
        self._static_vars:    dict = {}   # (func_name, var_name) -> persistent value
        self._static_frame_keys: dict = {} # func_name -> {var_name, ...}
        self._output_width: int   = 0    # setw(n) state
        self._output_fill:  str   = ' '  # setfill(c) state
        self._output_hex:   bool  = False # hex/dec manipulator state
        self._output_precision: int = -1  # setprecision(n): -1 = default
        self._output_fixed: bool  = False # fixed/scientific mode

    # ── Preprocessing ───────────────────────────────────────────────────────

    def _preprocess(self, source: str) -> tuple[str, int]:
        """
        Strip #include / #pragma lines (replace with blank lines to keep numbering),
        prepend stubs, return (processed_source, line_offset).
        """
        lines = source.split('\n')
        cleaned = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith('#include') or stripped.startswith('#pragma'):
                cleaned.append('')
            else:
                cleaned.append(line)
        body = '\n'.join(cleaned)
        full = _STUBS + body
        return full, _STUBS_LINES

    # ── Public entry point ──────────────────────────────────────────────────

    def run(self) -> list:
        import sys
        sys.setrecursionlimit(max(sys.getrecursionlimit(), MAX_CALL_DEPTH * 120))
        _reset_addr()

        processed, self._line_offset = self._preprocess(self.source)
        self.source_lines = self.source.split('\n')

        idx = cindex.Index.create()
        tu  = idx.parse(
            'input.cpp',
            unsaved_files=[('input.cpp', processed)],
            args=['-std=c++17', '-x', 'c++'],
        )

        # Only truly fatal parse errors (missing braces etc.) stop us.
        # Undefined-symbol errors from stripped headers are expected — ignore them.
        hard_fatal = [
            d for d in tu.diagnostics
            if d.severity >= cindex.Diagnostic.Fatal
        ]
        if hard_fatal:
            raise ValueError(f"Compile error: {hard_fatal[0].spelling}")

        self._collect_toplevel(tu.cursor)

        if 'main' not in self.func_defs:
            raise ValueError(
                "No main() function found. Make sure your program has int main() { ... }"
            )

        struct_defs = {
            name: {f: self._simple_type(t) for f, t in cd['fields'].items()}
            for name, cd in self.class_defs.items()
        }
        self.memory = Memory(struct_defs)
        self.memory.push_frame('main', 1)
        self._emit(1, 'Program starts. main() is pushed onto the call stack.', {'type': 'start'})

        # Execute global variable declarations in the main frame
        for gvar in self._global_var_cursors:
            try:
                self._exec_decl(gvar)
            except Exception:
                pass

        body = self._body_of(self.func_defs['main'])
        crashed = False
        try:
            self._exec_compound(body)
        except TraceTruncated as e:
            # Not a crash — just too many steps. Emit a descriptive end step.
            self.trace.append({
                'index':       len(self.trace),
                'line':        -1,
                'description': e.hint,
                'event':       {'type': 'end', 'leaks': [], 'truncated': True},
                'memory':      self.memory.snapshot(),
            })
            return self.trace
        except SegFaultError as e:
            crashed = True
            # _crash() may have already appended a crash step — don't duplicate it
            already = (self.trace and self.trace[-1].get('event', {}).get('type') == 'crash')
            if not already:
                ln = self._adj(e.line) if e.line else -1
                desc = f'Line {ln}: {e.message}' if ln > 0 else e.message
                self.memory.update_line(ln)
                self.trace.append({
                    'index':       len(self.trace),
                    'line':        ln,
                    'description': desc,
                    'event': {
                        'type':    'crash',
                        'kind':    e.kind,
                        'address': e.address,
                        'message': desc,
                    },
                    'memory': self.memory.snapshot(),
                })
        except ReturnException:
            pass

        if not crashed:
            # Call destructors for main's local variables
            try:
                self._call_frame_destructors(-1)
            except Exception:
                pass
            leaks = [a for a, b in self.memory.heap.items() if b['state'] == 'allocated']
            desc  = ("Program ends cleanly. No memory leaks."
                     if not leaks
                     else f"Program ends. {len(leaks)} memory leak(s): {', '.join(leaks)}")
            self.trace.append({
                'index':  len(self.trace),
                'line':   -1,
                'description': desc,
                'event':  {'type': 'end', 'leaks': leaks},
                'memory': self.memory.snapshot(),
            })
        self.trace = self._merge_output_steps(self.trace)
        return self.trace

    def _merge_output_steps(self, steps: list) -> list:
        """Merge consecutive output steps on the same source line into one.

        cout << x << endl emits separate steps for each <<-chained value.
        Students don't need to watch '\n' appended as a separate step.
        The merged step keeps the memory snapshot of the last constituent step.
        """
        if not steps:
            return steps
        merged = []
        i = 0
        while i < len(steps):
            step = steps[i]
            if step.get('event', {}).get('type') != 'output':
                merged.append(step)
                i += 1
                continue
            # Collect a run of consecutive output events
            run = [step]
            j = i + 1
            while j < len(steps) and steps[j].get('event', {}).get('type') == 'output':
                run.append(steps[j])
                j += 1
            # Combine their texts into one step
            combined_text = ''.join(s['event']['text'] for s in run)
            last = run[-1]
            disp = combined_text.replace('\n', ' ').replace('\t', ' ').strip()
            merged.append({
                'index':       len(merged),
                'line':        run[0]['line'],
                'description': f"Output: {disp}" if disp else "Output: (newline)",
                'event':       {'type': 'output', 'text': combined_text},
                'memory':      last['memory'],
            })
            i = j
        # Re-index
        for idx, s in enumerate(merged):
            s['index'] = idx
        return merged

    # ── Collection phase ────────────────────────────────────────────────────

    def _collect_toplevel(self, cursor):
        for child in self._ch(cursor):
            if child.location.file and child.location.file.name != 'input.cpp':
                continue
            k = child.kind
            if k == CK.FUNCTION_DECL and child.is_definition():
                # Only user-defined functions (not stub declarations which lack bodies)
                if child.location.line > self._line_offset:
                    self.func_defs[child.spelling] = child
            elif k == CK.CLASS_DECL and child.is_definition():
                # Only user-defined classes (not stub declarations)
                if child.location.line > self._line_offset:
                    self._collect_class(child)
            elif k == CK.NAMESPACE:
                self._collect_toplevel(child)
            elif k == CK.STRUCT_DECL and child.is_definition():
                # Only user-defined structs (not stub declarations)
                if child.location.line > self._line_offset:
                    self._collect_class(child)
            elif k == CK.TYPEDEF_DECL and child.location.line > self._line_offset:
                # Handle: typedef struct Node { ... } Node;
                # The STRUCT_DECL is nested inside TYPEDEF_DECL so collect it here.
                typedef_name = child.spelling
                for sub in self._ch(child):
                    if sub.kind == CK.STRUCT_DECL and sub.is_definition():
                        self._collect_class(sub)
                        # If anonymous struct (no spelling), also register under typedef name
                        struct_name = sub.spelling or typedef_name
                        if typedef_name and typedef_name not in self.class_defs and struct_name in self.class_defs:
                            self.class_defs[typedef_name] = self.class_defs[struct_name]
                        break
            elif k == CK.CLASS_TEMPLATE and child.is_definition():
                if child.location.line > self._line_offset:
                    self._collect_class(child)
            elif k == CK.FUNCTION_TEMPLATE and child.is_definition():
                if child.location.line > self._line_offset:
                    self.func_defs[child.spelling] = child
            elif k == CK.ENUM_DECL and child.location.line > self._line_offset:
                self._collect_enum(child)
            elif k == CK.VAR_DECL and child.location.line > self._line_offset:
                self._global_var_cursors.append(child)
            elif (k in (CK.CONSTRUCTOR, CK.CXX_METHOD, CK.DESTRUCTOR)
                  and child.is_definition() and child.location.line > self._line_offset):
                # Out-of-class method definitions (e.g. template<T> MyClass<T>::method() {...})
                sp = child.semantic_parent
                cls_name = sp.spelling if sp else ''
                if cls_name and cls_name in self.class_defs:
                    if k == CK.CONSTRUCTOR:
                        self.class_defs[cls_name]['ctors'].append(child)
                    elif k == CK.DESTRUCTOR:
                        self.class_defs[cls_name]['methods']['~' + cls_name] = child
                    else:
                        self.class_defs[cls_name]['methods'][child.spelling] = child

    def _collect_class(self, cursor):
        name = cursor.spelling
        if not name:
            return
        cd: dict = {'fields': {}, 'ctors': [], 'methods': {}, 'bases': []}
        for child in self._ch(cursor):
            ck = child.kind
            if ck == CK.CXX_BASE_SPECIFIER:
                base_name = child.spelling.replace('class ', '').replace('struct ', '').strip()
                if base_name:
                    cd['bases'].append(base_name)
            elif ck == CK.FIELD_DECL:
                cd['fields'][child.spelling] = child.type.spelling
            elif ck == CK.CONSTRUCTOR and child.is_definition():
                cd['ctors'].append(child)
            elif ck == CK.DESTRUCTOR and child.is_definition():
                cd['methods']['~' + name] = child
            elif ck == CK.CXX_METHOD and child.is_definition():
                cd['methods'][child.spelling] = child
            elif ck in (CK.CLASS_DECL, CK.STRUCT_DECL) and child.is_definition():
                self._collect_class(child)
        self.class_defs[name] = cd

    def _collect_enum(self, cursor):
        """Register enum constants so DECL_REF_EXPR can resolve them."""
        enum_name = cursor.spelling  # empty for anonymous enums
        for child in self._ch(cursor):
            if child.kind == CK.ENUM_CONSTANT_DECL:
                self.enum_constants[child.spelling] = child.enum_value
                if enum_name:
                    self.enum_constants[f'{enum_name}::{child.spelling}'] = child.enum_value

    # ── Statement execution ─────────────────────────────────────────────────

    def _exec_compound(self, cursor):
        if cursor is None:
            return
        for child in self._ch(cursor):
            self._exec_stmt(child)

    def _exec_scoped_compound(self, cursor):
        """Execute a nested block statement, calling destructors for block-local
        variables when the block exits (even via break/continue/return)."""
        if not self.memory.stack:
            self._exec_compound(cursor)
            return
        frame = self.memory.stack[-1]
        before_vars = set(frame['variables'].keys())
        exc = None
        try:
            self._exec_compound(cursor)
        except (ReturnException, BreakException, ContinueException) as e:
            exc = e
        finally:
            new_vars = [v for v in frame['variables'] if v not in before_vars]
            if new_vars:
                self._call_named_destructors(new_vars, cursor.location.line)
        if exc is not None:
            raise exc

    def _call_named_destructors(self, var_names: list, line: int):
        """Call destructors for named local variables in reverse declaration order.
        Only removes struct/class variables that have a destructor (to prevent
        double-firing at function exit). Non-struct variables stay in the frame."""
        if not self.memory.stack:
            return
        frame = self.memory.stack[-1]
        for var_name in reversed(var_names):
            val = frame['variables'].get(var_name)
            if isinstance(val, dict) and val.get('kind') == 'struct':
                class_name = val.get('class', '')
                if class_name and class_name in self.class_defs:
                    dtor_name = '~' + class_name
                    cd = self.class_defs[class_name]
                    if dtor_name in cd.get('methods', {}):
                        try:
                            self._call_method_on_stack(class_name, var_name, None, dtor_name, [], line)
                        except Exception:
                            pass
                        # Remove from frame so frame-exit destructor doesn't double-fire
                        frame['variables'].pop(var_name, None)

    def _exec_stmt(self, cursor):
        if cursor is None:
            return
        k = cursor.kind
        if   k == CK.DECL_STMT:
            for c in self._ch(cursor):
                if c.kind == CK.VAR_DECL:
                    self._exec_decl(c)
                elif c.kind == CK.UNEXPOSED_DECL:
                    self._exec_structured_binding(c)
                elif c.kind == CK.ENUM_DECL:
                    self._collect_enum(c)
        elif k == CK.VAR_DECL:
            self._exec_decl(cursor)
        elif k == CK.COMPOUND_STMT:
            self._exec_scoped_compound(cursor)
        elif k == CK.IF_STMT:
            self._exec_if(cursor)
        elif k == CK.FOR_STMT:
            self._exec_for(cursor)
        elif k == CK.WHILE_STMT:
            self._exec_while(cursor)
        elif k == CK.DO_STMT:
            self._exec_do(cursor)
        elif k == CK.CXX_FOR_RANGE_STMT:
            self._exec_range_for(cursor)
        elif k == CK.RETURN_STMT:
            ch = self._ch(cursor)
            val = self._eval(ch[0]) if ch else None
            raise ReturnException(val)
        elif k == CK.SWITCH_STMT:
            self._exec_switch(cursor)
        elif k == CK.BREAK_STMT:
            raise BreakException()
        elif k == CK.CONTINUE_STMT:
            raise ContinueException()
        elif k == CK.NULL_STMT:
            pass
        elif k == CK.CASE_STMT:
            case_ch = self._ch(cursor)
            if len(case_ch) > 1:
                self._exec_stmt(case_ch[1])
        elif k == CK.LABEL_STMT:
            ch = self._ch(cursor)
            if ch:
                self._exec_stmt(ch[0])
        elif k == CK.CXX_TRY_STMT:
            self._exec_try(cursor)
        elif k == CK.CXX_THROW_EXPR:
            ch = self._ch(cursor)
            thrown_val = self._eval(ch[0]) if ch else _INT(0)
            raise ThrownException(thrown_val)
        else:
            self._eval(cursor)

    def _exec_decl(self, cursor):
        if cursor.kind != CK.VAR_DECL:
            return
        line       = cursor.location.line
        name       = cursor.spelling
        type_spell = cursor.type.spelling

        # ── static local variable — value persists across calls ──
        try:
            import clang.cindex as _ci
            if cursor.storage_class == _ci.StorageClass.STATIC:
                func_name = self.memory.stack[-1]['function'] if self.memory.stack else '__global__'
                skey = (func_name, name)
                if skey in self._static_vars:
                    # Already initialized on a prior call — use persisted value
                    val = self._static_vars[skey]
                else:
                    # First call — evaluate init, save persistently
                    ch = self._ch(cursor)
                    non_tr = [c for c in ch if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
                    val = self._eval(non_tr[0]) if non_tr else _INT(0)
                    self._static_vars[skey] = val
                # Track which vars in this function are static so we can save on exit
                self._static_frame_keys.setdefault(func_name, set()).add(name)
                self.memory.declare_var(name, val)
                self.memory.update_line(line)
                self._emit(line, f"Declare static {name} = {self._fmt(val)}.",
                           {'type': 'assign', 'target': name, 'value': self._fmt(val)})
                return
        except Exception:
            pass
        # Resolve type aliases: 'pii' → 'std::pair<int,int>', 'vi' → 'std::vector<int,...>'
        try:
            canon = cursor.type.get_canonical().spelling
            if canon and '<' in canon and '<' not in type_spell and type_spell not in ('auto', 'auto &', 'auto&&'):
                type_spell = canon
        except Exception:
            pass
        children   = self._ch(cursor)

        # ── lvalue reference variable: int& r = a ──
        if '&' in type_spell and '&&' not in type_spell and '*' not in type_spell:
            non_tr = [c for c in children if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
            if non_tr and non_tr[0].kind == CK.DECL_REF_EXPR:
                target_name = non_tr[0].spelling
                ref_val = {'kind': 'ref', 'target': target_name}
                self.memory.declare_var(name, ref_val)
                self.memory.update_line(line)
                self._emit(line, f"Declare {name} = ref({target_name}).",
                           {'type': 'assign', 'target': name, 'value': f'ref({target_name})'})
                return

        # ── auto — infer type from initialiser ──
        # Also catch iterator types (e.g. std::vector<int>::iterator) which libclang
        # resolves for auto variables in template contexts.
        is_iterator_type = ('::iterator' in type_spell or '::const_iterator' in type_spell
                            or type_spell == 'iterator')
        is_lambda_type   = type_spell.startswith('(lambda at')
        if type_spell.startswith('auto') or type_spell == 'auto' or is_iterator_type or is_lambda_type:
            # Skip type reference nodes (TYPE_REF, TEMPLATE_REF) to find the actual initializer
            _non_type_ch = [c for c in children
                            if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
            init_c = _non_type_ch[0] if _non_type_ch else (children[0] if children else None)
            uw = self._unwrap(init_c) or init_c if init_c else None
            if uw and uw.kind == CK.LAMBDA_EXPR:
                # Store the lambda cursor for later invocation by name
                self._lambda_store[name] = uw
                val = _INT(0)  # placeholder value
            else:
                val = self._eval(init_c) if init_c else _INT(0)
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} = {self._fmt(val)}.",
                       {'type': 'assign', 'target': name, 'value': self._fmt(val)})
            return

        # ── pair<T,U> ── (must not fire on vector/set/map/queue of pairs)
        if ('pair' in type_spell and '*' not in type_spell and 'vector' not in type_spell
                and 'set<' not in type_spell and 'map<' not in type_spell
                and 'queue' not in type_spell and 'stack' not in type_spell):
            val = {'kind': 'struct', 'fields': {'first': _INT(0), 'second': _INT(0)}}
            if children:
                non_tr = [c for c in children if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
                if non_tr:
                    init_val = self._eval(non_tr[0])
                    if isinstance(init_val, dict) and init_val.get('kind') == 'struct':
                        val = init_val
                    elif len(non_tr) == 2:
                        val = self._make_pair(self._eval(non_tr[0]), self._eval(non_tr[1]))
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} = pair.",
                       {'type': 'assign', 'target': name, 'value': 'pair'})
            return

        # ── priority_queue ──
        if 'priority_queue' in type_spell:
            is_min = 'greater' in type_spell
            val = {'kind': 'array', 'values': [], 'label': type_spell,
                   'ctype': 'priority_queue', 'min_heap': is_min}
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} (priority_queue).",
                       {'type': 'assign', 'target': name, 'value': 'priority_queue'})
            # PQ name vs ordering mismatch (#23 Wrong Priority Queue Ordering)
            name_lower = name.lower()
            wants_min = any(tok in name_lower for tok in ('min', 'small', 'shortest', 'dist', 'cost'))
            wants_max = any(tok in name_lower for tok in ('max', 'large', 'biggest'))
            if wants_min and not is_min:
                self._warn(line, 'pq-order-mismatch',
                           f"'{name}' sounds like a min-heap but uses default max-heap ordering. "
                           f"Add greater<int> comparator or use priority_queue<int,vector<int>,greater<int>> (#23).")
            elif wants_max and is_min:
                self._warn(line, 'pq-order-mismatch',
                           f"'{name}' sounds like a max-heap but was declared with greater<> (min-heap). "
                           f"Remove the greater<> comparator (#23).")
            return

        # ── Fixed-size C array of vectors: vector<int> adj[6] ──
        if self._is_vector_type(type_spell) and re.search(r'\[\d+\]', type_spell):
            m_arr = re.search(r'\[(\d+)\]', type_spell)
            n = int(m_arr.group(1))
            _LAZY_THRESHOLD = 256
            if n > _LAZY_THRESHOLD:
                # Large adj/dist arrays: start empty, inner vectors extend lazily on push_back/clear
                val = {'kind': 'array', 'values': [], 'declared_size': n}
            else:
                val = {'kind': 'array', 'values': [{'kind': 'array', 'values': []} for _ in range(n)],
                       'declared_size': n}
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name}[{n}] (vector array).",
                       {'type': 'assign', 'target': name, 'value': f'[{n}]'})
            return

        # ── vector<> ──
        if self._is_vector_type(type_spell):
            # Check if initializer is a user function returning a vector (not the vector
            # constructor itself). e.g. `vector<int> dist = dijkstra(...)`.
            # In that case evaluate the function call and use the result directly.
            ctor_children = children
            val = None
            for c in children:
                uw = self._unwrap(c) or c
                if uw.kind == CK.CALL_EXPR and self._is_vector_type(uw.type.spelling):
                    spell = uw.spelling or ''
                    if spell in ('vector', '') or self._is_vector_type(spell):
                        # True vector constructor — use its children as constructor args
                        ctor_children = self._ch(uw)
                    else:
                        # Function returning a vector — evaluate and use result directly
                        result = self._eval(uw)
                        if isinstance(result, dict) and result.get('kind') == 'array':
                            val = result
                    break
            if val is None:
                # Use canonical type so typedef-based pair types (e.g. `pii`) are detected
                canon = cursor.type.get_canonical().spelling if cursor.type else type_spell
                val = self._init_vector(canon or type_spell, ctor_children, line)
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            shape = (f"[{val['rows']}][{val['cols']}]"
                     if val.get('cols') is not None
                     else f"[{len(val.get('values', []))}]")
            self._emit(line, f"Declare {name}{shape} (vector).",
                       {'type': 'assign', 'target': name, 'value': shape})
            return

        # ── queue / stack / deque ── (render as array so frontend handles it)
        if any(ct in type_spell for ct in ('queue', 'stack', 'deque')):
            val = {'kind': 'array', 'values': [], 'label': type_spell, 'ctype': type_spell}
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} ({type_spell}).",
                       {'type': 'assign', 'target': name, 'value': type_spell})
            return

        # ── map / unordered_map ──
        if any(ct in type_spell for ct in ('map<', 'unordered_map<')):
            val = {'kind': 'map', 'data': {}, 'label': type_spell}
            # Populate from initializer {{k,v}, ...}
            non_tr = [c for c in children if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
            if non_tr:
                pairs = self._extract_map_init_pairs(non_tr[0])
                for kv, vv in pairs:
                    val['data'][self._make_map_key(kv)] = vv
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} (map).",
                       {'type': 'assign', 'target': name, 'value': 'map'})
            return

        # ── multiset ──
        if 'multiset<' in type_spell:
            val = {'kind': 'multiset', 'data': []}
            # Initialize from iterator range: multiset<T> ms(v.begin(), v.end())
            for child in children:
                uw = self._unwrap(child) or child
                # Look for a CALL_EXPR that evaluates to an array (begin/end call)
                if uw.kind == CK.CALL_EXPR:
                    src = self._eval(uw)
                    if isinstance(src, dict) and src.get('kind') == 'array':
                        for elem in src.get('values', []):
                            key = self._make_map_key(elem)
                            val['data'].append({'key': key, 'val': elem})
                        val['data'].sort(key=lambda e: self._set_sort_key(e['key']))
                        break
                    # begin() iterator — extract data from iterator's source array
                    if isinstance(src, dict) and src.get('kind') == 'iterator':
                        src_data = src.get('data', [])
                        if isinstance(src_data, list):
                            for elem in src_data:
                                ev = elem if isinstance(elem, dict) else _INT(int(elem))
                                key = self._make_map_key(ev)
                                val['data'].append({'key': key, 'val': ev})
                            val['data'].sort(key=lambda e: self._set_sort_key(e['key']))
                        break
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} (multiset).",
                       {'type': 'assign', 'target': name, 'value': 'multiset'})
            return

        # ── set / unordered_set ──
        if any(ct in type_spell for ct in ('set<', 'unordered_set<')):
            val = {'kind': 'set', 'data': [], 'label': type_spell}
            non_tr = [c for c in children if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
            if non_tr:
                for ev in self._extract_set_init_values(non_tr[0]):
                    key = self._make_map_key(ev)
                    if not any(e['key'] == key for e in val['data']):
                        val['data'].append({'key': key, 'val': ev})
                if 'unordered_set' not in type_spell:
                    val['data'].sort(key=lambda e: self._set_sort_key(e['key']))
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} (set).",
                       {'type': 'assign', 'target': name, 'value': 'set'})
            return

        # ── C-style array of structs: Student students[3] = {{...},{...}} ──
        if '[' in type_spell and self._is_class_type(type_spell):
            base_t = self._base_type(type_spell)
            dims_t = [int(d) for d in re.findall(r'\[(\d+)\]', type_spell)]
            n_t = dims_t[0] if dims_t else 0
            structs = []
            init_c_t = next((c for c in children if c.kind == CK.INIT_LIST_EXPR), None)
            if init_c_t:
                for i_t, elem_c in enumerate(self._ch(init_c_t)):
                    if i_t >= n_t: break
                    structs.append(self._init_class_on_stack(base_t, [elem_c], line))
            while len(structs) < n_t:
                structs.append(self._init_class_on_stack(base_t, [], line))
            val = {'kind': 'array', 'values': structs, 'declared_size': n_t}
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name}[{n_t}] (struct array).",
                       {'type': 'assign', 'target': name, 'value': f'[{n_t}]'})
            return

        # ── C-style array ──
        if '[' in type_spell and not self._is_class_type(type_spell):
            val = self._init_c_array(cursor, children)
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} (array).",
                       {'type': 'assign', 'target': name, 'value': 'array'})
            return

        # ── pointer (must come before class check — TreeNode* must not match class branch) ──
        if '*' in type_spell:
            val = {'kind': 'pointer', 'address': None}
            if children:
                # CXX_NEW_EXPR may come after TYPE_REF — scan all children
                new_c = next((c for c in children if c.kind == CK.CXX_NEW_EXPR), None)
                if new_c:
                    val = self._eval_new(new_c)
                else:
                    non_tr = [c for c in children
                              if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF,
                                                CK.PARM_DECL)]
                    if non_tr:
                        val = self._eval(non_tr[0])
                        # NULL (defined as 0) → coerce to null pointer
                        if isinstance(val, dict) and val.get('kind') == 'int' and val.get('value') == 0:
                            val = {'kind': 'pointer', 'address': None}
                        # Array-to-pointer decay: int* p = arr → track as array_ptr
                        elif isinstance(val, dict) and val.get('kind') == 'array':
                            arr_name = non_tr[0].spelling or self._cursor_name(non_tr[0])
                            val = {'kind': 'array_ptr', 'name': arr_name, 'idx': 0}
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} = {self._fmt(val)}.",
                       {'type': 'assign', 'target': name, 'value': self._fmt(val)})
            return

        # ── class / struct ──
        base = self._base_type(type_spell)
        if base in self.class_defs:
            val = self._init_class_on_stack(base, children, line)
            self.memory.declare_var(name, val)
            self.memory.update_line(line)
            self._emit(line, f"Declare {name} ({base}).",
                       {'type': 'assign', 'target': name, 'value': base})
            return

        # ── primitive ──
        # Skip TYPE_REF/TEMPLATE_REF (appear when a typedef name is used, e.g. `const ll x = 5`)
        non_tr = [c for c in children if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
        _is_fp_type = any(t in type_spell for t in ('float', 'double'))
        if non_tr:
            val = self._eval(non_tr[0])
            # Coerce int→float when the declared type is float/double
            if _is_fp_type and isinstance(val, dict) and val.get('kind') == 'int':
                val = _FLOAT(float(val.get('value', 0)))
        else:
            val = self._default_for_type(type_spell)
            # Mark local scalar without explicit initializer as uninitialized (#17)
            _prim_kw = ('int', 'long', 'short', 'bool', 'float', 'double')
            if (isinstance(val, dict) and val.get('kind') == 'int'
                    and len(self.memory.stack) > 0
                    and any(p in type_spell.lower() for p in _prim_kw)
                    and '*' not in type_spell and '[' not in type_spell):
                val = {**val, '_uninit': True}
        self.memory.declare_var(name, val)
        self.memory.update_line(line)
        self._emit(line, f"Declare {name} = {self._fmt(val)}.",
                   {'type': 'assign', 'target': name, 'value': self._fmt(val)})

    def _exec_if(self, cursor):
        ch = self._ch(cursor)
        if not ch:
            return
        cond = self._eval(ch[0])
        if self._truthy(cond):
            if len(ch) > 1:
                self._exec_stmt(ch[1])
        else:
            if len(ch) > 2:
                self._exec_stmt(ch[2])

    def _exec_for(self, cursor):
        line = cursor.location.line
        ch   = self._ch(cursor)

        def is_null(c): return c is None or c.kind == CK.NULL_STMT

        if   len(ch) == 4: init_c, cond_c, incr_c, body_c = ch
        elif len(ch) == 3:
            # libclang omits the NULL_STMT for absent init/incr.
            # If first child is a DECL_STMT the init is present and incr is absent:
            #   for (int i = 0; cond;) body  → [DECL_STMT, cond, body]
            # Otherwise init is absent and both cond and incr are present:
            #   for (; cond; incr) body       → [cond, incr, body]
            if ch[0].kind == CK.DECL_STMT:
                init_c, cond_c, body_c = ch; incr_c = None
            else:
                cond_c, incr_c, body_c = ch; init_c = None
        elif len(ch) == 2: cond_c, body_c = ch;  init_c = incr_c = None
        elif len(ch) == 1: body_c = ch[0]; init_c = cond_c = incr_c = None
        else: return

        # Execute init in a new scope: save any existing vars that the init might
        # shadow (e.g. `for(int g=...; ...)` where `g` is already a parameter).
        # Restore them after the loop so the outer scope is unaffected.
        _shadowed = {}
        if init_c and not is_null(init_c):
            if self.memory.stack:
                _frame = self.memory.stack[-1]
                # Find var names declared by the init statement
                _init_names = set()
                if init_c.kind == CK.DECL_STMT:
                    for _ic in self._ch(init_c):
                        if _ic.kind == CK.VAR_DECL and _ic.spelling:
                            _init_names.add(_ic.spelling)
                # Save existing values for vars about to be shadowed
                for _n in _init_names:
                    if _n in _frame['variables']:
                        _shadowed[_n] = _frame['variables'][_n]
            self._exec_stmt(init_c)

        # Binary search loop detection: check if loop scope has lo/hi/mid vars (#11)
        _BS_VARS = {'lo', 'hi', 'left', 'right', 'mid', 'l', 'r'}
        _bs_warned = False

        iters = 0
        while True:
            if cond_c and not is_null(cond_c):
                if not self._truthy(self._eval(cond_c)):
                    break
            iters += 1
            if iters > MAX_ITERS:
                raise TraceTruncated(
                    f'⚠ Infinite loop detected: this for-loop ran {iters} times without terminating. '
                    'Check your loop condition.'
                )
            # Warn if binary search loop runs suspiciously many times (#11)
            if not _bs_warned and iters == 200:
                frame_vars = set(self.memory.stack[-1]['variables'].keys()) if self.memory.stack else set()
                if _BS_VARS & frame_vars and 'mid' in frame_vars:
                    self._warn(line, 'wrong-binary-search',
                               f"Loop with binary search variables (lo/hi/mid) has run {iters} iterations. "
                               f"Binary search should finish in O(log n) ≈ 30 steps — "
                               f"check that mid is updated correctly and the range shrinks each iteration (#11).")
                    _bs_warned = True
            try:
                if body_c and not is_null(body_c):
                    self._exec_stmt(body_c)
            except BreakException:
                break
            except ContinueException:
                pass
            if incr_c and not is_null(incr_c):
                self._eval(incr_c)

        # Restore shadowed variables (for-init scope ends here)
        if _shadowed and self.memory.stack:
            _frame = self.memory.stack[-1]
            for _n, _v in _shadowed.items():
                _frame['variables'][_n] = _v

    def _exec_while(self, cursor):
        line = cursor.location.line
        ch   = self._ch(cursor)
        if len(ch) < 2:
            return
        cond_c, body_c = ch[0], ch[1]
        iters = 0
        while True:
            if not self._truthy(self._eval(cond_c)):
                break
            iters += 1
            if iters > MAX_ITERS:
                raise TraceTruncated(
                    f'⚠ Infinite loop detected: this while-loop ran {iters} times without terminating. '
                    'Check your loop condition.'
                )
            try:
                self._exec_stmt(body_c)
            except BreakException:
                break
            except ContinueException:
                continue

    def _exec_do(self, cursor):
        line = cursor.location.line
        ch   = self._ch(cursor)
        if len(ch) < 2:
            return
        body_c, cond_c = ch[0], ch[1]
        iters = 0
        while True:
            try:
                self._exec_stmt(body_c)
            except BreakException:
                break
            except ContinueException:
                pass
            iters += 1
            if iters > MAX_ITERS:
                raise TraceTruncated(
                    f'⚠ Infinite loop detected: this do-while loop ran {iters} times without terminating. '
                    'Check your loop condition.'
                )
            if not self._truthy(self._eval(cond_c)):
                break

    def _exec_try(self, cursor):
        """Execute try-catch block. CXX_TRY_STMT: [COMPOUND_STMT(try), CXX_CATCH_STMT...]"""
        ch = self._ch(cursor)
        if not ch:
            return
        try_body = ch[0]
        catch_clauses = [c for c in ch[1:] if c.kind == CK.CXX_CATCH_STMT]
        try:
            self._exec_compound(try_body)
        except ThrownException as exc:
            # Find first matching catch clause (we match any for simplicity)
            for clause in catch_clauses:
                clause_ch = self._ch(clause)
                # First child may be VAR_DECL for the caught variable
                var_decl = clause_ch[0] if clause_ch and clause_ch[0].kind == CK.VAR_DECL else None
                catch_body = next((c for c in clause_ch if c.kind == CK.COMPOUND_STMT), None)
                if var_decl and catch_body:
                    self.memory.stack[-1]['variables'][var_decl.spelling] = exc.value
                elif catch_body is None and clause_ch:
                    catch_body = clause_ch[-1]
                if catch_body:
                    try:
                        self._exec_compound(catch_body)
                    except ReturnException:
                        raise
                    except BreakException:
                        raise
                break  # only first matching clause

    def _exec_switch(self, cursor):
        children = self._ch(cursor)
        if not children:
            return
        cond_c   = children[0]
        body_c   = children[1] if len(children) > 1 else None
        cond_val = self._to_int(self._eval(cond_c))
        line     = cursor.location.line
        self._emit(line, f"switch({cond_val}).",
                   {'type': 'assign', 'target': 'switch', 'value': str(cond_val)})
        if body_c is None:
            return
        # Flatten the body into direct children (the compound stmt contains case/default stmts)
        body_stmts = self._ch(body_c) if body_c.kind == CK.COMPOUND_STMT else [body_c]
        # Find matching case index
        matching_idx = None
        default_idx  = None
        for i, stmt in enumerate(body_stmts):
            if stmt.kind == CK.DEFAULT_STMT:
                default_idx = i
            elif stmt.kind == CK.CASE_STMT:
                case_ch = self._ch(stmt)
                if case_ch:
                    try:
                        case_val = self._to_int(self._eval(case_ch[0]))
                        if case_val == cond_val and matching_idx is None:
                            matching_idx = i
                    except Exception:
                        pass
        if matching_idx is None:
            matching_idx = default_idx
        if matching_idx is None:
            return
        # Execute from matching_idx, falling through until BreakException
        try:
            for i in range(matching_idx, len(body_stmts)):
                stmt = body_stmts[i]
                if stmt.kind == CK.CASE_STMT:
                    case_ch = self._ch(stmt)
                    # child[0] = case value, child[1] = first body stmt (if any)
                    if len(case_ch) > 1:
                        self._exec_stmt(case_ch[1])
                elif stmt.kind == CK.DEFAULT_STMT:
                    default_ch = self._ch(stmt)
                    if default_ch:
                        self._exec_stmt(default_ch[0])
                else:
                    self._exec_stmt(stmt)
        except BreakException:
            pass

    # ── Expression evaluation ───────────────────────────────────────────────

    def _eval(self, cursor) -> dict:
        if cursor is None:
            return _INT(0)
        k = cursor.kind

        # Transparent wrappers
        if k in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR,
                 CK.CXX_FUNCTIONAL_CAST_EXPR,
                 CK.CXX_STATIC_CAST_EXPR, CK.CXX_CONST_CAST_EXPR,
                 CK.CXX_REINTERPRET_CAST_EXPR, CK.CSTYLE_CAST_EXPR):
            ch = self._ch(cursor)
            if not ch:
                # UNEXPOSED_EXPR[type=bool, no children]: libclang hides pointer
                # comparison results (e.g. ptr != NULL).  Fall back to token parsing.
                if k == CK.UNEXPOSED_EXPR and 'bool' in (cursor.type.spelling or ''):
                    return self._eval_bool_tokens(cursor)
                # UNEXPOSED_EXPR with no children in compound-assign RHS context
                # (e.g. s in `res += s[0]`): recover variable name from tokens.
                if k == CK.UNEXPOSED_EXPR:
                    return self._eval_token_expr(
                        [t.spelling for t in cursor.get_tokens()],
                        cursor.location.line,
                    )
                return _INT(0)
            # UNEXPOSED_EXPR can represent a C-style call (e.g. malloc inside a function):
            # ch[0] = OVERLOADED_DECL_REF or DECL_REF_EXPR wrapping one, ch[1:] = args
            if k == CK.UNEXPOSED_EXPR and len(ch) >= 2:
                callee_c = ch[0]
                fn_name  = None
                if callee_c.kind == CK.OVERLOADED_DECL_REF:
                    fn_name = callee_c.spelling
                elif callee_c.kind == CK.DECL_REF_EXPR:
                    sub = self._ch(callee_c)
                    if sub and sub[0].kind == CK.OVERLOADED_DECL_REF:
                        fn_name = sub[0].spelling
                    # Lambda variable call: query(0, 3) → UNEXPOSED_EXPR[DECL_REF_EXPR 'query', args...]
                    elif callee_c.spelling in self._lambda_store:
                        fn_name = callee_c.spelling
                if fn_name:
                    arg_cursors = ch[1:]
                    args        = [self._eval(c) for c in arg_cursors]
                    line        = cursor.location.line
                    return self._call_function(fn_name, args, line, arg_cursors=arg_cursors)
                # UNEXPOSED_EXPR[MEMBER_REF_EXPR, args...]: libclang represents some method
                # calls this way (e.g. s.erase(it) where it is an iterator variable).
                # Reuse _eval_call since it reads children via _ch() the same way.
                if callee_c.kind == CK.MEMBER_REF_EXPR:
                    return self._eval_call(cursor)
            # Cast expressions: (ll)x or string("foo") — skip TYPE_REF/TEMPLATE_REF wrapper
            if k in (CK.CSTYLE_CAST_EXPR, CK.CXX_FUNCTIONAL_CAST_EXPR) and ch[0].kind in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF):
                non_tr = [c for c in ch if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
                val = self._eval(non_tr[0]) if non_tr else _INT(0)
            else:
                val = self._eval(ch[0])
            # Apply type conversion for explicit casts
            if k in (CK.CSTYLE_CAST_EXPR, CK.CXX_STATIC_CAST_EXPR, CK.CXX_FUNCTIONAL_CAST_EXPR):
                tgt = cursor.type.spelling if cursor.type else ''
                if any(t in tgt for t in ('float', 'double')):
                    if isinstance(val, dict) and val.get('kind') == 'int':
                        return _FLOAT(float(val.get('value', 0)))
                elif tgt in ('int', 'unsigned int', 'long', 'short', 'unsigned', 'unsigned long',
                             'long long', 'unsigned long long'):
                    if _is_float_val(val):
                        return _INT(int(val.get('value', 0)))
                    if isinstance(val, dict) and val.get('kind') == 'char':
                        v = val.get('value', '')
                        return _INT(ord(v[0]) if v else 0)
                elif tgt == 'char':
                    n = self._to_int(val)
                    return {'kind': 'char', 'value': chr(int(n) & 0xFF)}
            return val

        if k == CK.INTEGER_LITERAL:         return self._eval_int_lit(cursor)
        if k == CK.FLOATING_LITERAL:        return self._eval_float_lit(cursor)
        if k == CK.CHARACTER_LITERAL:       return self._eval_char_lit(cursor)
        if k == CK.CXX_BOOL_LITERAL_EXPR:   return self._eval_bool_lit(cursor)
        if k == CK.STRING_LITERAL:           return self._eval_string_lit(cursor)
        if k == CK.CXX_NULL_PTR_LITERAL_EXPR: return {'kind': 'pointer', 'address': None}
        if k == CK.CXX_THIS_EXPR:           return {'kind': 'pointer', 'address': '__this__'}

        if k == CK.DECL_REF_EXPR:           return self._eval_decl_ref(cursor)
        if k == CK.MEMBER_REF_EXPR:         return self._eval_member_ref(cursor)

        if k == CK.BINARY_OPERATOR:         return self._eval_binary(cursor)
        if k == CK.COMPOUND_ASSIGNMENT_OPERATOR: return self._eval_compound_assign(cursor)
        if k in (CK.UNARY_OPERATOR, CK.CXX_UNARY_EXPR): return self._eval_unary(cursor)
        if k == CK.CONDITIONAL_OPERATOR:    return self._eval_ternary(cursor)
        if k == CK.ARRAY_SUBSCRIPT_EXPR:    return self._eval_subscript(cursor)

        if k == CK.CALL_EXPR:               return self._eval_call(cursor)

        if k == CK.CXX_NEW_EXPR:            return self._eval_new(cursor)
        if k == CK.CXX_DELETE_EXPR:         return self._eval_delete(cursor)

        if k == CK.INIT_LIST_EXPR:          return self._eval_init_list(cursor)

        if k == CK.VAR_DECL:
            self._exec_decl(cursor)
            return _INT(0)
        if k == CK.DECL_STMT:
            for c in self._ch(cursor):
                if c.kind == CK.VAR_DECL:
                    self._exec_decl(c)
            return _INT(0)

        return _INT(0)

    # ── Literals ────────────────────────────────────────────────────────────

    def _eval_int_lit(self, cursor) -> dict:
        for tok in cursor.get_tokens():
            s = tok.spelling.rstrip('uUlL')
            # C-style octal (032) → Python-style octal (0o32)
            if (len(s) > 1 and s[0] == '0'
                    and s[1:2] not in ('x', 'X', 'o', 'O', 'b', 'B')):
                s = '0o' + s[1:]
            try:
                return _INT(int(s, 0))
            except ValueError:
                pass
        return _INT(0)

    def _eval_float_lit(self, cursor) -> dict:
        for tok in cursor.get_tokens():
            s = tok.spelling.rstrip('fFdD')
            try:
                return _FLOAT(float(s))
            except ValueError:
                pass
        return _FLOAT(0.0)

    def _eval_char_lit(self, cursor) -> dict:
        for tok in cursor.get_tokens():
            s = tok.spelling.strip("'")
            if s.startswith('\\'):
                esc = {'\\n': '\n', '\\t': '\t', '\\0': '\0',
                       '\\\\': '\\', "\\'": "'", '\\r': '\r'}
                s = esc.get(s, s[1:] if len(s) > 1 else s)
            return {'kind': 'char', 'value': s}
        return {'kind': 'char', 'value': ''}

    def _eval_bool_lit(self, cursor) -> dict:
        toks = list(cursor.get_tokens())
        return _INT(1 if toks and toks[0].spelling == 'true' else 0)

    def _eval_string_lit(self, cursor) -> dict:
        for tok in cursor.get_tokens():
            s = tok.spelling
            if s.startswith('"') and s.endswith('"'):
                s = s[1:-1]
            # Decode C escape sequences stored as raw text by libclang
            s = s.replace('\\n', '\n').replace('\\t', '\t').replace('\\r', '\r')
            s = s.replace('\\0', '\0').replace('\\\\', '\\').replace("\\'", "'")
            s = s.replace('\\"', '"')
            return {'kind': 'char', 'value': s[:256]}
        return {'kind': 'char', 'value': ''}

    # ── References / member refs ────────────────────────────────────────────

    def _eval_decl_ref(self, cursor) -> dict:
        name = cursor.spelling
        if name in ('nullptr', 'NULL'):  return {'kind': 'pointer', 'address': None}
        if name == 'true':               return _INT(1)
        if name == 'false':              return _INT(0)
        if name == 'INT_MAX':            return _INT(2147483647)
        if name == 'INT_MIN':            return _INT(-2147483648)
        if name == 'LLONG_MAX':          return _INT(9223372036854775807)
        if name == 'LLONG_MIN':          return _INT(-9223372036854775808)
        if name == 'npos':               return _INT(-1)  # string::npos
        try:
            val = self.memory.get_var(name)
            # Dereference reference variables
            if isinstance(val, dict) and val.get('kind') == 'ref':
                try:
                    val = self.memory.get_var(val['target'])
                except RuntimeError:
                    pass
            # Uninitialized variable read (#17)
            if isinstance(val, dict) and val.get('_uninit'):
                self._warn(cursor.location.line, 'uninit-var',
                           f"Variable '{name}' is read before being initialized. "
                           f"Its value is undefined — initialize it before use.")
                # Clear flag so we warn only on the first read
                val = {k: v for k, v in val.items() if k != '_uninit'}
                for frame in reversed(self.memory.stack):
                    if name in frame['variables']:
                        frame['variables'][name] = val
                        break
            return val
        except RuntimeError:
            # Might be a this-field accessed without explicit this->
            if self._this_stack:
                val = self._read_this_field(name, cursor.location.line)
                if val is not None:
                    return val
            # Fall back to enum constants (unscoped enums resolve as DECL_REF_EXPR)
            if name in self.enum_constants:
                return _INT(self.enum_constants[name])
            # Function pointer: name refers to a user-defined function
            if name in self.func_defs:
                return {'kind': 'funcptr', 'name': name}
            return _INT(0)

    def _eval_member_ref(self, cursor) -> dict:
        """obj.field  or  ptr->field  or  this->field"""
        field = cursor.spelling or self._member_field_name(cursor)
        ch    = self._ch(cursor)

        if not ch:
            return self._read_this_field(field, cursor.location.line) or _INT(0)

        obj_c = ch[0]
        if obj_c.kind == CK.CXX_THIS_EXPR:
            return self._read_this_field(field, cursor.location.line) or _INT(0)

        obj_val  = self._eval(obj_c)
        obj_type = obj_c.type.spelling if obj_c.type else ''

        if isinstance(obj_val, dict):
            if obj_val.get('kind') == 'struct':
                return copy.deepcopy(
                    obj_val['fields'].get(field, _INT(0))
                )
            if obj_val.get('kind') == 'pointer':
                addr = obj_val.get('address')
                if addr is None:
                    self._crash(cursor.location.line, 'null-deref',
                                f"Null pointer dereference: accessing field '{field}' on nullptr")
                if addr and addr != '__this__':
                    return self.memory.read_field(addr, field, cursor.location.line)
        return _INT(0)

    # ── Binary operator ─────────────────────────────────────────────────────

    def _eval_binary(self, cursor) -> dict:
        op = self._get_binary_op(cursor)
        ch = self._ch(cursor)
        if len(ch) < 2:
            return _INT(0)

        if op == '=':
            rval = self._eval(ch[1])
            self._write_lval(ch[0], rval, cursor.location.line)
            return rval

        if op == '&&':
            l = self._eval(ch[0])
            if not self._truthy(l): return _INT(0)
            r = self._eval(ch[1])
            return _INT(int(self._truthy(r)))
        if op == '||':
            l = self._eval(ch[0])
            if self._truthy(l): return _INT(1)
            r = self._eval(ch[1])
            return _INT(int(self._truthy(r)))

        # Detect cout << ... appearing as BINARY_OPERATOR (happens when the rhs
        # is a complex expression like a map subscript that libclang can't type)
        if op == '<<':
            def _is_cout_bin(c):
                if c is None: return False
                if c.kind == CK.DECL_REF_EXPR and c.spelling in ('cout', 'cerr'): return True
                if c.kind == CK.BINARY_OPERATOR:
                    bch = self._ch(c)
                    return bool(bch) and _is_cout_bin(bch[0])
                return False
            if _is_cout_bin(ch[0]):
                self._eval(ch[0])  # recurse — output left chain
                line  = cursor.location.line
                # Check for endl/hex/dec manipulators by token spelling
                rhs_sp = ch[1].spelling if ch[1] else ''
                if rhs_sp in ('endl', 'std::endl', 'ends', '\n'):
                    self._emit(line, 'Output: newline', {'type': 'output', 'text': '\n'})
                    return _INT(0)
                if rhs_sp in ('hex', 'std::hex'):
                    self._output_hex = True; return _INT(0)
                if rhs_sp in ('dec', 'std::dec'):
                    self._output_hex = False; return _INT(0)
                if rhs_sp in ('fixed', 'std::fixed'):
                    self._output_fixed = True; return _INT(0)
                if rhs_sp in ('scientific', 'std::scientific'):
                    self._output_fixed = True; return _INT(0)
                r_val = self._eval(ch[1])
                # Manip value (setw/setfill returned from function call)
                if isinstance(r_val, dict) and r_val.get('kind') == 'manip':
                    mt = r_val.get('mtype')
                    if mt == 'setw':         self._output_width = r_val.get('value', 0)
                    elif mt == 'setfill':    self._output_fill = r_val.get('value', ' ')
                    elif mt == 'setprecision': self._output_precision = r_val.get('value', -1)
                    elif mt == 'fixed':      self._output_fixed = True
                    elif mt == 'scientific': self._output_fixed = True
                    return _INT(0)
                text  = self._val_to_output_text(r_val)
                if text is not None and (text or text == '0'):
                    if self._output_hex and isinstance(r_val, dict) and r_val.get('kind') == 'int':
                        text = hex(r_val.get('value', 0))[2:]  # strip '0x' prefix like C++ cout<<hex
                    w = self._output_width; self._output_width = 0
                    if w > len(text):
                        text = text.rjust(w, self._output_fill)
                    _disp = text.replace('\n', ' ').replace('\t', ' ').strip()
                    self._emit(line, f"Output: {_disp or '(newline)'}",
                               {'type': 'output', 'text': text})
                return _INT(0)

        # Bitmask operator precedence check (#30): a & b == 0 parses as a & (b==0)
        if op in ('&', '|', '^'):
            for child in ch:
                inner = child
                # Unwrap one level of implicit cast if present
                if inner.kind in (CK.CSTYLE_CAST_EXPR, CK.CXX_STATIC_CAST_EXPR,
                                   CK.CXX_FUNCTIONAL_CAST_EXPR, CK.UNEXPOSED_EXPR):
                    inner_ch = self._ch(inner)
                    if inner_ch: inner = inner_ch[0]
                if inner.kind == CK.BINARY_OPERATOR and child.kind != CK.PAREN_EXPR:
                    cmp_op = self._get_binary_op(inner)
                    if cmp_op in ('==', '!=', '<', '>', '<=', '>='):
                        self._warn(cursor.location.line, 'bitmask-precedence',
                                   f"Operator precedence: '{op}' binds looser than '{cmp_op}'. "
                                   f"'{op}' is applied LAST here. Did you mean ({{}}{op}{{}}) {cmp_op} {{}}? "
                                   f"Add parentheses to make intent explicit.")
                        break

        l = self._eval(ch[0])
        r = self._eval(ch[1])

        # array_ptr / array arithmetic: p+n, p-n, p-q, arr+n
        if isinstance(l, dict) and l.get('kind') == 'array_ptr':
            if op in ('+', '-') and not (isinstance(r, dict) and r.get('kind') == 'array_ptr'):
                n = int(self._to_int(r))
                return {**l, 'idx': l.get('idx', 0) + (n if op == '+' else -n)}
            if op == '-' and isinstance(r, dict) and r.get('kind') == 'array_ptr':
                return _INT(l.get('idx', 0) - r.get('idx', 0))
            # array_ptr comparison: p < q, p != q, etc.
            if op in ('<', '>', '<=', '>=', '==', '!=') and isinstance(r, dict) and r.get('kind') == 'array_ptr':
                li, ri = l.get('idx', 0), r.get('idx', 0)
                return _INT(int({'<': li<ri, '>': li>ri, '<=': li<=ri, '>=': li>=ri, '==': li==ri, '!=': li!=ri}[op]))
        if isinstance(r, dict) and r.get('kind') == 'array_ptr' and op == '+':
            n = int(self._to_int(l))
            return {**r, 'idx': r.get('idx', 0) + n}
        # Array (C-array) + int → array_ptr
        if isinstance(l, dict) and l.get('kind') == 'array' and op in ('+', '-'):
            if not (isinstance(r, dict) and r.get('kind') in ('array', 'array_ptr')):
                n = int(self._to_int(r))
                arr_name = ch[0].spelling if ch else ''
                return {'kind': 'array_ptr', 'name': arr_name, 'idx': n if op == '+' else -n}
        if isinstance(r, dict) and r.get('kind') == 'array' and op == '+':
            n = int(self._to_int(l))
            arr_name = ch[1].spelling if len(ch) > 1 else ''
            return {'kind': 'array_ptr', 'name': arr_name, 'idx': n}

        # Iterator comparison: compare idx directly (None = end sentinel)
        if (isinstance(l, dict) and l.get('kind') == 'iterator' and
                isinstance(r, dict) and r.get('kind') == 'iterator'):
            li, ri = l.get('idx'), r.get('idx')
            cmp = {'==': li == ri, '!=': li != ri,
                   '<': (li or 0) < (ri or 0), '>': (li or 0) > (ri or 0),
                   '<=': (li or 0) <= (ri or 0), '>=': (li or 0) >= (ri or 0)}
            return _INT(int(cmp.get(op, False)))

        # char op char
        if (isinstance(l, dict) and l.get('kind') == 'char' and
                isinstance(r, dict) and r.get('kind') == 'char'):
            lv_s, rv_s = l.get('value', ''), r.get('value', '')
            if op == '==': return _INT(int(lv_s == rv_s))
            if op == '!=': return _INT(int(lv_s != rv_s))
            if op == '<':  return _INT(int(lv_s <  rv_s))
            if op == '>':  return _INT(int(lv_s >  rv_s))
            if op == '<=': return _INT(int(lv_s <= rv_s))
            if op == '>=': return _INT(int(lv_s >= rv_s))
            if op == '+':  return {'kind': 'char', 'value': lv_s + rv_s}
            # char - char → integer difference (like C++)
            if op == '-':  return _INT(ord(lv_s[0]) - ord(rv_s[0]) if lv_s and rv_s else 0)
        # char +/- int: result is char (only when rhs is NOT a char)
        if (isinstance(l, dict) and l.get('kind') == 'char' and op in ('+', '-')
                and not (isinstance(r, dict) and r.get('kind') == 'char')):
            lv_c = ord(l.get('value', '\0')) if l.get('value') else 0
            rv_c = self._to_int(r)
            result_code = lv_c + int(rv_c) if op == '+' else lv_c - int(rv_c)
            return {'kind': 'char', 'value': chr(result_code & 0xFF)}

        lv, rv = self._to_int(l), self._to_int(r)
        is_fp = _is_float_val(l) or _is_float_val(r)

        if   op == '+':  result = lv + rv
        elif op == '-':  result = lv - rv
        elif op == '*':  result = lv * rv
        elif op == '/':
            if rv == 0: self._crash(cursor.location.line, 'division-by-zero', 'Division by zero')
            result = lv / rv if is_fp else lv // rv
        elif op == '%':
            if rv == 0: self._crash(cursor.location.line, 'division-by-zero', 'Modulo by zero')
            result = lv % rv
        elif op == '==': return _INT(int(lv == rv))
        elif op == '!=': return _INT(int(lv != rv))
        elif op == '<':  return _INT(int(lv <  rv))
        elif op == '>':  return _INT(int(lv >  rv))
        elif op == '<=': return _INT(int(lv <= rv))
        elif op == '>=': return _INT(int(lv >= rv))
        elif op == '&':  result = int(lv) & int(rv)
        elif op == '|':  result = int(lv) | int(rv)
        elif op == '^':  result = int(lv) ^ int(rv)
        elif op == '<<': result = int(lv) << (int(rv) % 32)
        elif op == '>>': result = int(lv) >> (int(rv) % 32)
        else:            result = 0

        if is_fp:
            return _FLOAT(float(result))

        # Integer overflow detection: warn and wrap to 32-bit signed range
        if op in ('+', '-', '*') and (result > 2147483647 or result < -2147483648):
            wrapped = (result + 2**31) % 2**32 - 2**31
            self._warn(cursor.location.line, 'int-overflow',
                       f'Integer overflow: {lv} {op} {rv} = {result} '
                       f'(exceeds 32-bit int range, wraps to {wrapped})')
            result = wrapped

        return _INT(result)

    def _eval_compound_assign(self, cursor) -> dict:
        op  = self._get_binary_op(cursor)   # e.g. '+='
        bop = op.rstrip('=')                # e.g. '+'
        ch  = self._ch(cursor)
        if len(ch) < 2:
            return _INT(0)

        l_val = self._eval(ch[0])
        r_val = self._eval(ch[1])

        # array_ptr += / -= n
        if isinstance(l_val, dict) and l_val.get('kind') == 'array_ptr' and bop in ('+', '-'):
            n = int(self._to_int(r_val))
            new_val = {**l_val, 'idx': l_val.get('idx', 0) + (n if bop == '+' else -n)}
            self._write_lval(ch[0], new_val, cursor.location.line)
            return new_val

        # String += (concatenation)
        if (op == '+=' and isinstance(l_val, dict) and l_val.get('kind') == 'char'):
            ls = l_val.get('value', '')
            if isinstance(r_val, dict) and r_val.get('kind') == 'char':
                rs = r_val.get('value', '')
            elif isinstance(r_val, dict) and r_val.get('kind') == 'int':
                rs = chr(r_val.get('value', 0))
            else:
                rs = str(self._to_int(r_val))
            new_val = {'kind': 'char', 'value': ls + rs}
            self._write_lval(ch[0], new_val, cursor.location.line)
            return new_val

        lv = self._to_int(l_val)
        rv = self._to_int(r_val)
        is_fp = _is_float_val(l_val) or _is_float_val(r_val)
        if is_fp:
            result = {
                '+': lv + rv,  '-': lv - rv,  '*': lv * rv,
                '/': (lv / rv) if rv != 0 else 0.0,
                '%': (lv % rv) if rv != 0 else 0.0,
            }.get(bop, rv)
            new_val = _FLOAT(float(result))
        else:
            result = {
                '+': lv + rv,  '-': lv - rv,  '*': lv * rv,
                '/': (lv // rv) if rv != 0 else 0,
                '%': (lv %  rv) if rv != 0 else 0,
                '&': int(lv) & int(rv),  '|': int(lv) | int(rv),  '^': int(lv) ^ int(rv),
                '<<': int(lv) << (int(rv) % 32), '>>': int(lv) >> (int(rv) % 32),
            }.get(bop, rv)
            new_val = _INT(result)
        self._write_lval(ch[0], new_val, cursor.location.line)
        return new_val

    # ── Unary operator ──────────────────────────────────────────────────────

    def _eval_unary(self, cursor) -> dict:
        op   = self._get_unary_op(cursor)
        ch   = self._ch(cursor)
        line = cursor.location.line

        if op == 'sizeof':
            # sizeof(T) has no expression child — return a type-based size
            if ch:
                t = ch[0].type.spelling if ch[0].type else ''
            else:
                t = cursor.type.spelling
            for name, size in (
                ('char', 1), ('short', 2), ('int', 4), ('float', 4),
                ('long', 8), ('double', 8), ('pointer', 8),
            ):
                if name in t:
                    return _INT(size)
            if '*' in t:
                return _INT(8)
            base = t.replace('struct ', '').replace('class ', '').strip()
            if base in self.class_defs:
                return _INT(self.memory._sizeof(base))
            return _INT(4)  # safe default

        if not ch:
            return _INT(0)

        if op in ('!', 'not'):
            return _INT(int(not self._truthy(self._eval(ch[0]))))
        if op == '-':
            v = self._eval(ch[0])
            n = self._to_int(v)
            return _FLOAT(-n) if _is_float_val(v) else _INT(-int(n))
        if op == '+':
            return self._eval(ch[0])
        if op == '~':
            return _INT(~self._to_int(self._eval(ch[0])))
        if op == '*':
            ptr = self._eval(ch[0])
            if not isinstance(ptr, dict):
                return _INT(ptr) if isinstance(ptr, (int, float)) else _INT(0)
            if ptr.get('kind') == 'iterator':
                _data = ptr.get('data', [])
                _idx  = ptr.get('idx')
                if _idx is not None and 0 <= _idx < len(_data):
                    _e = _data[_idx]
                    if isinstance(_e, dict) and 'key' in _e:
                        return _e.get('val', _INT(0))
                    return _e if isinstance(_e, dict) else _INT(int(_e))
                return _INT(0)
            if ptr.get('kind') == 'array_ptr':
                arr_name = ptr.get('name', '')
                idx = ptr.get('idx', 0)
                try:
                    arr = self.memory.get_var(arr_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        vals = arr.get('values', [])
                        if 0 <= idx < len(vals):
                            v = vals[idx]
                            return v if isinstance(v, dict) else _INT(int(v))
                except RuntimeError:
                    pass
                return _INT(0)
            if ptr.get('kind') != 'pointer':
                # * on a non-pointer (e.g. result of max_element): return the value itself
                return ptr
            addr = ptr.get('address')
            offset = ptr.get('offset', 0)
            if offset and addr and addr in self.memory.heap:
                block = self.memory.heap[addr]
                arr = block['fields'].get('_arr')
                if arr and arr.get('kind') == 'array':
                    vals = arr.get('values', [])
                    if 0 <= offset < len(vals):
                        v = vals[offset]
                        return v if isinstance(v, dict) else _INT(int(v))
            if addr == '__this__':
                # *this — return current object value from the this binding
                if self._this_stack:
                    b = self._this_stack[-1]
                    if b.kind == 'stack' and b.frame_idx is not None:
                        return copy.deepcopy(
                            self.memory.stack[b.frame_idx]['variables'].get(b.var_name, _INT(0))
                        )
                    if b.kind == 'heap' and b.addr and b.addr in self.memory.heap:
                        fields = self.memory.heap[b.addr].get('fields', {})
                        return {'kind': 'struct', 'fields': copy.deepcopy(fields), 'class': b.class_name}
                return _INT(0)
            return self.memory.read_via_addr(addr, line)
        if op == '&':
            if ch[0].kind == CK.DECL_REF_EXPR:
                try:
                    return {'kind': 'pointer', 'address': self.memory.addr_of_var(ch[0].spelling)}
                except RuntimeError:
                    pass
            return {'kind': 'pointer', 'address': None}
        if op in ('++', '--'):                  # prefix
            val     = self._eval(ch[0])
            delta   = 1 if op == '++' else -1
            if isinstance(val, dict) and val.get('kind') == 'iterator':
                _data = val.get('data', [])
                _cur  = val.get('idx')
                _cur  = 0 if _cur is None else _cur
                _new  = _cur + delta
                new_val = {**val, 'idx': None if _new >= len(_data) else _new}
            elif isinstance(val, dict) and val.get('kind') == 'array_ptr':
                new_val = {**val, 'idx': val.get('idx', 0) + delta}
            elif isinstance(val, dict) and val.get('kind') == 'pointer':
                new_val = self._pointer_advance(val, delta, line)
            elif isinstance(val, dict) and val.get('kind') == 'char':
                new_val = {'kind': 'char', 'value': chr((ord(val.get('value', '\0')) + delta) & 0xFF)}
            elif _is_float_val(val):
                new_val = _FLOAT(val.get('value', 0.0) + delta)
            else:
                new_val = _INT(self._to_int(val) + delta)
            self._write_lval(ch[0], new_val, line)
            return new_val
        if op in ('p++', 'p--'):                # postfix
            val     = self._eval(ch[0])
            delta   = 1 if op == 'p++' else -1
            if isinstance(val, dict) and val.get('kind') == 'iterator':
                _data = val.get('data', [])
                _cur  = val.get('idx')
                _cur  = 0 if _cur is None else _cur
                _new  = _cur + delta
                new_val = {**val, 'idx': None if _new >= len(_data) else _new}
            elif isinstance(val, dict) and val.get('kind') == 'array_ptr':
                new_val = {**val, 'idx': val.get('idx', 0) + delta}
            elif isinstance(val, dict) and val.get('kind') == 'pointer':
                new_val = self._pointer_advance(val, delta, line)
            elif isinstance(val, dict) and val.get('kind') == 'char':
                new_val = {'kind': 'char', 'value': chr((ord(val.get('value', '\0')) + delta) & 0xFF)}
            elif _is_float_val(val):
                new_val = _FLOAT(val.get('value', 0.0) + delta)
            else:
                new_val = _INT(self._to_int(val) + delta)
            self._write_lval(ch[0], new_val, line)
            return val                          # return old value

        return self._eval(ch[0])

    # ── Bool-token fallback ─────────────────────────────────────────────────
    # libclang sometimes produces UNEXPOSED_EXPR[type=bool] with no children for
    # pointer comparisons (ptr != NULL, ptr == nullptr, etc.).  We recover the
    # expression from source tokens.

    def _eval_bool_tokens(self, cursor) -> dict:
        tokens = [t.spelling for t in cursor.get_tokens()]
        if not tokens:
            return _INT(0)
        line = cursor.location.line

        # Handle leading '!' → NOT of the rest
        if tokens and tokens[0] == '!':
            inner = self._eval_token_expr(tokens[1:], line)
            return _INT(int(not self._truthy(inner)))

        # Find a binary comparison operator (longest match first to get != before !)
        for op in ('!=', '==', '<=', '>=', '<', '>'):
            if op in tokens:
                idx = tokens.index(op)
                lv = self._eval_token_expr(tokens[:idx], line)
                rv = self._eval_token_expr(tokens[idx+1:], line)
                li, ri = self._to_int(lv), self._to_int(rv)
                result = {
                    '!=': int(li != ri), '==': int(li == ri),
                    '<':  int(li <  ri), '>':  int(li >  ri),
                    '<=': int(li <= ri), '>=': int(li >= ri),
                }[op]
                return _INT(result)

        # Truthy check on a single expression
        val = self._eval_token_expr(tokens, line)
        return _INT(int(self._truthy(val)))

    def _eval_token_expr(self, tokens: list, line: int) -> dict:
        """Evaluate a simple token sequence like ['node','->','left'] or ['NULL']."""
        while tokens and tokens[0] in ('(', ')'):
            tokens = tokens[1:]
        while tokens and tokens[-1] in ('(', ')'):
            tokens = tokens[:-1]
        if not tokens:
            return _INT(0)
        if tokens[0] == '!':
            inner = self._eval_token_expr(tokens[1:], line)
            return _INT(int(not self._truthy(inner)))
        if len(tokens) == 1:
            t = tokens[0]
            if t in ('NULL', 'nullptr', 'null'):
                return {'kind': 'pointer', 'address': None}
            try:
                return _INT(int(t))
            except ValueError:
                pass
            try:
                return self.memory.get_var(t)
            except RuntimeError:
                return _INT(0)
        # ptr->field chain (handles ptr->field and ptr->field[i])
        if '->' in tokens:
            arrow_i    = tokens.index('->')
            obj_tokens = tokens[:arrow_i]
            remaining  = tokens[arrow_i + 1:]          # e.g. ['children', '[', 'index', ']']
            field      = remaining[0] if remaining else ''
            suffix     = remaining[1:]                  # e.g. ['[', 'index', ']']
            obj_val    = self._eval_token_expr(obj_tokens, line)
            if isinstance(obj_val, dict) and obj_val.get('kind') == 'pointer':
                addr = obj_val.get('address')
                if addr and addr in self.memory.heap:
                    field_val = self.memory.read_field(addr, field, line)
                    # Apply subscript suffix: ->field[i]
                    if suffix and '[' in suffix and ']' in suffix:
                        bi = suffix.index('[')
                        ei = suffix.index(']')
                        sub_idx = self._to_int(self._eval_token_expr(suffix[bi + 1:ei], line))
                        if isinstance(field_val, dict) and field_val.get('kind') == 'array':
                            vals = field_val.get('values', [])
                            if 0 <= sub_idx < len(vals):
                                v = vals[sub_idx]
                                return v if isinstance(v, dict) else _INT(int(v))
                        return _INT(0)
                    return field_val
            return _INT(0)
        # obj.field
        if '.' in tokens:
            idx = tokens.index('.')
            obj_tokens = tokens[:idx]
            field = tokens[idx+1] if idx+1 < len(tokens) else ''
            obj_val = self._eval_token_expr(obj_tokens, line)
            if isinstance(obj_val, dict) and obj_val.get('kind') == 'struct':
                return obj_val['fields'].get(field, _INT(0))
            return _INT(0)
        # arr[i] subscript
        if '[' in tokens and ']' in tokens:
            bi = tokens.index('[')
            ei = tokens.index(']')
            arr_val = self._eval_token_expr(tokens[:bi], line)
            idx_val = self._eval_token_expr(tokens[bi+1:ei], line)
            idx = self._to_int(idx_val)
            if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                vals = arr_val.get('values', [])
                if 0 <= idx < len(vals):
                    v = vals[idx]
                    return v if isinstance(v, dict) else _INT(int(v))
        return _INT(0)

    # ── Ternary ─────────────────────────────────────────────────────────────

    def _eval_ternary(self, cursor) -> dict:
        ch = self._ch(cursor)
        if len(ch) < 3:
            return _INT(0)
        cond = self._eval(ch[0])
        return self._eval(ch[1]) if self._truthy(cond) else self._eval(ch[2])

    # ── Subscript ───────────────────────────────────────────────────────────

    def _eval_subscript(self, cursor) -> dict:
        """arr[i]  or  arr[i][j]"""
        ch = self._ch(cursor)
        if len(ch) < 2:
            return _INT(0)
        arr_c, idx_c = ch[0], ch[1]
        idx = self._to_int(self._eval(idx_c))

        # 2-D: inner child is itself a subscript
        inner = self._unwrap(arr_c)
        if inner and inner.kind in (CK.ARRAY_SUBSCRIPT_EXPR,):
            ich = self._ch(inner)
            if len(ich) >= 2:
                row = self._to_int(self._eval(ich[1]))
                arr_val = self._eval(ich[0])
                # Resolve array_ptr to actual array (2D array passed to function)
                if isinstance(arr_val, dict) and arr_val.get('kind') == 'array_ptr':
                    # Prefer embedded data (avoids shadowing by same-named parameter)
                    _embedded = arr_val.get('data')
                    if isinstance(_embedded, dict) and _embedded.get('kind') == 'array':
                        arr_val = _embedded
                    else:
                        _rn = arr_val.get('name', '')
                        try:
                            _ra = self.memory.get_var(_rn)
                            if isinstance(_ra, dict) and _ra.get('kind') == 'array':
                                arr_val = _ra
                        except RuntimeError:
                            pass
                vals = arr_val.get('values', []) if isinstance(arr_val, dict) else []
                line = cursor.location.line
                n_rows = arr_val.get('rows')
                n_cols = arr_val.get('cols')
                row_bound = n_rows if n_rows is not None else (arr_val.get('declared_size') or len(vals))
                if not (0 <= row < row_bound):
                    self._crash(line, 'out-of-bounds',
                                f"Row index {row} out of bounds for {row_bound}-row vector")
                row_list = vals[row] if row < len(vals) else []
                col_bound = n_cols if n_cols is not None else (len(row_list) if isinstance(row_list, list) else 0)
                if isinstance(row_list, list):
                    if not (0 <= idx < col_bound):
                        self._crash(line, 'out-of-bounds',
                                    f"Column index {idx} out of bounds for {col_bound}-element row")
                    return _INT(int(row_list[idx]))
                return _INT(int(row_list)) if isinstance(row_list, (int, float)) else row_list

        arr_val = self._eval(arr_c)
        # array_ptr subscript: p[i] → arr[ptr.idx + i]
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'array_ptr':
            arr_name = arr_val.get('name', '')
            base_idx = arr_val.get('idx', 0)
            try:
                arr = self.memory.get_var(arr_name)
                # If name lookup returned the array_ptr itself (same name, callee shadows
                # caller), fall back to embedded data (struct/char array parameters).
                if isinstance(arr, dict) and arr.get('kind') == 'array_ptr':
                    arr = arr.get('data')
                if isinstance(arr, dict) and arr.get('kind') == 'array':
                    vals = arr.get('values', [])
                    real_idx = base_idx + int(idx)
                    if 0 <= real_idx < len(vals):
                        v = vals[real_idx]
                        return v if isinstance(v, dict) else _INT(int(v))
            except RuntimeError:
                pass
            return _INT(0)
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'char':
            s = arr_val.get('value', '')
            if 0 <= idx < len(s):
                return {'kind': 'char', 'value': s[idx]}
            return {'kind': 'char', 'value': ''}
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
            vals     = arr_val.get('values', [])
            declared = arr_val.get('declared_size')
            line     = cursor.location.line
            if not (0 <= idx < len(vals)):
                declared_bound = declared if declared is not None else len(vals)
                if 0 <= idx < declared_bound:
                    # Within declared bounds but beyond cap — return zero default
                    return _INT(0)
                # Improve message: off-by-one (#12) and graph indexing (#16)
                arr_name = getattr(arr_c, 'spelling', '') or ''
                _GRAPH_NAMES = {'adj', 'graph', 'g', 'edges', 'nb', 'neighbors', 'edge', 'node', 'to'}
                if idx == declared_bound:
                    msg = (f"Index {idx} out of bounds for array of size {declared_bound} "
                           f"— off-by-one error? Check whether loop uses '<' vs '<=' (#12)")
                elif any(n in arr_name.lower() for n in _GRAPH_NAMES):
                    msg = (f"Index {idx} out of bounds for array of size {declared_bound} "
                           f"on '{arr_name}' — wrong graph node index? Nodes must be in [0, n) (#16)")
                else:
                    msg = f"Index {idx} out of bounds for array of size {declared_bound}"
                self._crash(line, 'out-of-bounds', msg)
            cell = vals[idx]
            if isinstance(cell, list):
                return {'kind': 'array', 'values': cell}
            if isinstance(cell, dict):
                return cell
            return _INT(int(cell))
        # Pointer-subscript read: ptr[i] → look up heap block's _arr field
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'pointer':
            addr = arr_val.get('address')
            if addr and addr in self.memory.heap:
                block = self.memory.heap[addr]
                arr_field = block['fields'].get('_arr')
                if arr_field and arr_field.get('kind') == 'array':
                    vals = arr_field.get('values', [])
                    if 0 <= idx < len(vals):
                        v = vals[idx]
                        return v if isinstance(v, dict) else _INT(v)
                # Fall back to scalar 'value' field for ptr[0]
                if idx == 0:
                    return block['fields'].get('value', _INT(0))
        return _INT(0)

    # ── Function calls ──────────────────────────────────────────────────────
    # In this libclang version ALL calls are CALL_EXPR:
    #   • free-function calls  — ch[0] is DECL_REF_EXPR callee, ch[1:] args
    #   • method calls         — ch[0] is MEMBER_REF_EXPR callee (holds object), ch[1:] args
    #   • operator[] calls     — cursor.spelling == 'operator[]', ch[0] object, ch[-1] index
    #   • constructor calls    — cursor.spelling is class/vector name, all ch are args
    # ────────────────────────────────────────────────────────────────────────

    def _eval_call(self, cursor) -> dict:
        line = cursor.location.line
        fn   = cursor.spelling
        ch   = self._ch(cursor)
        if not ch and fn not in self.func_defs and fn not in self.class_defs:
            return _INT(0)

        callee_c = ch[0] if ch else None

        # ── operator= copy assignment (e.g. `M = mat_mul(M, M)`) ──────────
        # Structure: ch[0]=lhs, ch[1]=method-ref descriptor (skip), ch[2]=rhs
        if fn == 'operator=':
            lhs_c = ch[0] if ch else None
            # Find the real rhs — skip the method-ref descriptor (UNEXPOSED_EXPR
            # whose type is a function pointer like 'Matrix &(*)(Matrix &&) ...')
            rhs_c = None
            for cand in ch[1:]:
                t = cand.type.spelling if cand.type else ''
                if cand.kind == CK.UNEXPOSED_EXPR and '(*)' in t:
                    continue  # method-ref descriptor slot
                rhs_c = cand
                break
            rval = self._eval(rhs_c) if rhs_c else _INT(0)
            if lhs_c is not None:
                self._write_lval(lhs_c, rval, line)
            return rval

        # ── operator[] subscript read ──────────────────────────────────────
        if fn == 'operator[]':
            return self._eval_subscript_call(cursor)

        # ── operator() lambda/functor invocation ───────────────────────────
        # Structure: CALL_EXPR 'operator()' with
        #   ch[0] = UNEXPOSED_EXPR wrapping DECL_REF_EXPR 'lambdaName'
        #   ch[1] = UNEXPOSED_EXPR 'operator()' (method-ref slot — skip)
        #   ch[2:] = actual arguments
        if fn == 'operator()':
            actual = self._unwrap(callee_c) or callee_c if callee_c else None
            lambda_name = actual.spelling if actual and actual.kind == CK.DECL_REF_EXPR else ''
            if lambda_name and lambda_name in self._lambda_store:
                real_args_ch = [c for c in ch[1:]
                                if not (c.kind == CK.UNEXPOSED_EXPR and c.spelling == 'operator()')]
                real_args = [self._eval(c) for c in real_args_ch]
                return self._call_stored_lambda(lambda_name, real_args, line)
            # Functor: struct/class object with operator()
            if lambda_name:
                try: _fobj = self.memory.get_var(lambda_name)
                except: _fobj = None
                if isinstance(_fobj, dict) and _fobj.get('kind') == 'struct':
                    _fc = _fobj.get('class', '')
                    if _fc and _fc in self.class_defs and 'operator()' in self.class_defs[_fc].get('methods', {}):
                        _rch = [c for c in ch[1:]
                                if not (c.kind == CK.UNEXPOSED_EXPR and c.spelling == 'operator()')]
                        return self._call_method_on_stack(_fc, lambda_name, None, 'operator()', [self._eval(c) for c in _rch], line)

        # ── comparison operators (iterator, string, struct) ────────────────
        if fn in ('operator!=', 'operator==', 'operator<', 'operator>',
                  'operator<=', 'operator>='):
            real_args = []
            for cand in ch:
                sp = cand.spelling or ''
                type_sp = cand.type.spelling if cand.type else ''
                if cand.kind == CK.UNEXPOSED_EXPR and sp.startswith('operator') and '(*)' in type_sp:
                    continue  # method-ref descriptor slot
                real_args.append(cand)
            if len(real_args) >= 2:
                lv_val = self._eval(real_args[0])
                rv_val = self._eval(real_args[1])
                # Iterator comparison: compare idx directly (None = end)
                if (isinstance(lv_val, dict) and lv_val.get('kind') == 'iterator' and
                        isinstance(rv_val, dict) and rv_val.get('kind') == 'iterator'):
                    li, ri = lv_val.get('idx'), rv_val.get('idx')
                    cmp = {'operator==': li == ri, 'operator!=': li != ri,
                           'operator<': (li or 0) < (ri or 0), 'operator>': (li or 0) > (ri or 0),
                           'operator<=': (li or 0) <= (ri or 0), 'operator>=': (li or 0) >= (ri or 0)}
                    return _INT(int(cmp.get(fn, False)))
                # String (char kind) comparison
                if (isinstance(lv_val, dict) and lv_val.get('kind') == 'char' and
                        isinstance(rv_val, dict) and rv_val.get('kind') == 'char'):
                    ls, rs = lv_val.get('value', ''), rv_val.get('value', '')
                    cmp = {'operator==': ls == rs, 'operator!=': ls != rs,
                           'operator<': ls < rs, 'operator>': ls > rs,
                           'operator<=': ls <= rs, 'operator>=': ls >= rs}
                    return _INT(int(cmp.get(fn, False)))
                lv = self._to_int(lv_val)
                rv = self._to_int(rv_val)
                cmp = {'operator==': lv == rv, 'operator!=': lv != rv,
                       'operator<': lv < rv, 'operator>': lv > rv,
                       'operator<=': lv <= rv, 'operator>=': lv >= rv}
                return _INT(int(cmp.get(fn, False)))

        # ── operator* iterator dereference ─────────────────────────────────
        # Appears as CALL_EXPR 'operator*' when libclang resolves template types
        # (e.g. *max_element(...)). ch[0] is the iterator value (which for our
        # model is already the dereferenced value); just return it.
        if fn == 'operator*':
            val = self._eval(callee_c) if callee_c else _INT(0)
            if isinstance(val, dict) and val.get('kind') == 'iterator':
                idx  = val.get('idx')
                data = val.get('data', [])
                if idx is not None and 0 <= idx < len(data):
                    e = data[idx]
                    if isinstance(e, dict) and 'key' in e:
                        return e.get('val', _INT(0))
                    return e if isinstance(e, dict) else _INT(int(e))
                return _INT(0)
            return val

        # ── operator++ / operator-- on iterator (CALL_EXPR form) ────────────
        if fn in ('operator++', 'operator--'):
            # Find the variable cursor (skip method-ref slots)
            _var_c = None
            for _cand in ch:
                _sp = _cand.spelling or ''
                _tp = _cand.type.spelling if _cand.type else ''
                if _cand.kind == CK.UNEXPOSED_EXPR and _sp.startswith('operator') and '(*)' in _tp:
                    continue
                _var_c = _cand
                break
            if _var_c is not None:
                _val = self._eval(_var_c)
                _delta = 1 if fn == 'operator++' else -1
                if isinstance(_val, dict) and _val.get('kind') == 'iterator':
                    _data = _val.get('data', [])
                    _cur  = _val.get('idx')
                    _cur  = 0 if _cur is None else _cur
                    _new  = _cur + _delta
                    _new_val = {**_val, 'idx': None if _new >= len(_data) else _new}
                    self._write_lval(_var_c, _new_val, line)
                    return _new_val
                elif isinstance(_val, dict) and _val.get('kind') == 'array_ptr':
                    _new_val = {**_val, 'idx': _val.get('idx', 0) + _delta}
                    self._write_lval(_var_c, _new_val, line)
                    return _new_val
                else:
                    _new_val = _INT(self._to_int(_val) + _delta)
                    self._write_lval(_var_c, _new_val, line)
                    return _new_val

        # ── operator+ string concatenation ─────────────────────────────────
        if fn in ('operator+', 'operator+='):
            # When called as a method (MEMBER_REF_EXPR callee), extract the object
            # from the first child of the MEMBER_REF_EXPR (not the method ref itself).
            if callee_c and callee_c.kind == CK.MEMBER_REF_EXPR:
                mr_ch = self._ch(callee_c)
                lhs = self._eval(mr_ch[0]) if mr_ch else _INT(0)
                # With MEMBER_REF_EXPR callee, ch[1] is the real argument (no method-ref slot)
                rhs_c = ch[1] if len(ch) > 1 else None
            else:
                lhs = self._eval(callee_c) if callee_c else _INT(0)
                # libclang inserts a method-ref descriptor as ch[1] (UNEXPOSED_EXPR 'operator+')
                # when the call is (obj).operator+(arg) — skip it, real arg is ch[2]
                rhs_c = None
                for cand in ch[1:]:
                    sp = cand.spelling or ''
                    type_spell = cand.type.spelling if cand.type else ''
                    # Skip method-ref descriptor slots: UNEXPOSED_EXPR with function-pointer
                    # type like 'string &(*)(char)'. Real arguments (e.g. s[i] wrapped in
                    # UNEXPOSED_EXPR('operator[]')) have value types, not function-ptr types.
                    if cand.kind == CK.UNEXPOSED_EXPR and sp.startswith('operator') and '(*)' in type_spell:
                        continue  # method-ref slot — skip
                    rhs_c = cand
                    break
            rhs = self._eval(rhs_c) if rhs_c else _INT(0)
            if isinstance(lhs, dict) and lhs.get('kind') == 'char':
                lv = lhs.get('value', '')
                if isinstance(rhs, dict) and rhs.get('kind') == 'char':
                    rv = rhs.get('value', '')
                elif isinstance(rhs, dict) and rhs.get('kind') == 'int':
                    rv = chr(rhs.get('value', 0) & 0xFF)
                else:
                    rv = ''
                result = {'kind': 'char', 'value': lv + rv}
                if fn == 'operator+=':
                    if callee_c and callee_c.kind == CK.MEMBER_REF_EXPR:
                        mr_ch2 = self._ch(callee_c)
                        obj_name = self._cursor_name(mr_ch2[0]) if mr_ch2 else ''
                    else:
                        obj_name = self._cursor_name(callee_c) if callee_c else ''
                    if obj_name:
                        self.memory.set_var(obj_name, result)
                return result
            # User-defined operator+ on struct/class
            if isinstance(lhs, dict) and lhs.get('kind') == 'struct':
                class_name = self._base_type(
                    callee_c.type.spelling if callee_c and callee_c.type else '')
                if class_name and class_name in self.class_defs:
                    op_key = fn  # 'operator+' or 'operator+='
                    methods = self.class_defs[class_name].get('methods', {})
                    if op_key in methods:
                        obj_name = self._cursor_name(callee_c) if callee_c else ''
                        if obj_name:
                            return self._call_method_on_stack(
                                class_name, obj_name, callee_c, op_key, [rhs], line,
                                arg_cursors=[rhs_c] if rhs_c else None)
            return _INT(0)

        # ── cout << expr  (ch[0]=DECL_REF_EXPR 'cout', ch[1]=method-ref, ch[2]=arg)
        #    Also handles chaining: (cout<<a)<<b where ch[0] is another CALL_EXPR
        if fn in ('operator<<', ''):
            def _is_cout_stream(c) -> bool:
                if c is None:
                    return False
                if c.kind == CK.DECL_REF_EXPR and c.spelling in ('cout', 'cerr'):
                    return True
                if c.kind == CK.DECL_REF_EXPR and c.spelling not in ('cerr',):
                    # Variable bound to ostream sentinel (e.g. ostream& out param)
                    try:
                        v = self.memory.get_var(c.spelling)
                        if isinstance(v, dict) and v.get('kind') == 'ostream':
                            return True
                    except RuntimeError:
                        pass
                if c.kind == CK.CALL_EXPR and c.spelling in ('operator<<', ''):
                    sub = self._ch(c)
                    return _is_cout_stream(sub[0] if sub else None)
                return False
            def _is_cerr_stream(c) -> bool:
                if c is None: return False
                if c.kind == CK.DECL_REF_EXPR and c.spelling == 'cerr': return True
                if c.kind == CK.CALL_EXPR and c.spelling in ('operator<<', ''):
                    sub = self._ch(c)
                    return _is_cerr_stream(sub[0] if sub else None)
                return False
            if _is_cout_stream(callee_c):
                # Evaluate the left side (recursively emits its own output for chaining)
                self._eval(callee_c)
                # Find the actual argument: skip UNEXPOSED_EXPR whose spelling is 'operator<<'
                # (those are method-reference slots libclang inserts, not real args)
                for cand in ch[1:]:
                    sp = cand.spelling or ''
                    # Skip operator<< method-ref slots
                    if cand.kind == CK.UNEXPOSED_EXPR and sp == 'operator<<':
                        continue
                    # Skip DECL_REF_EXPR wrapping OVERLOADED_DECL_REF 'operator<<'
                    if cand.kind == CK.DECL_REF_EXPR and not sp:
                        sub = self._ch(cand)
                        if sub and sub[0].kind == CK.OVERLOADED_DECL_REF and sub[0].spelling == 'operator<<':
                            continue
                    # endl: direct DECL_REF or OVERLOADED wrapper
                    if sp in ('endl', 'std::endl', 'ends'):
                        self._emit(line, 'Output: newline', {'type': 'output', 'text': '\n'})
                        break
                    if cand.kind == CK.DECL_REF_EXPR and not sp:
                        sub = self._ch(cand)
                        if sub and sub[0].kind == CK.OVERLOADED_DECL_REF and sub[0].spelling in ('endl', 'ends'):
                            self._emit(line, 'Output: newline', {'type': 'output', 'text': '\n'})
                            break
                    # Stream manipulators by token name
                    if sp in ('hex', 'std::hex'):
                        self._output_hex = True; break
                    if sp in ('dec', 'std::dec'):
                        self._output_hex = False; break
                    if sp in ('fixed', 'std::fixed'):
                        self._output_fixed = True; break
                    if sp in ('scientific', 'std::scientific'):
                        self._output_fixed = True; break
                    # Real argument — unwrap UNEXPOSED_EXPR wrapper if present
                    real = (self._unwrap(cand) or cand) if cand.kind == CK.UNEXPOSED_EXPR else cand
                    val  = self._eval(real)
                    # Stream manipulator values (setw/setfill)
                    if isinstance(val, dict) and val.get('kind') == 'manip':
                        mt = val.get('mtype')
                        if mt == 'setw':         self._output_width = val.get('value', 0)
                        elif mt == 'setfill':    self._output_fill = val.get('value', ' ')
                        elif mt == 'setprecision': self._output_precision = val.get('value', -1)
                        elif mt == 'fixed':      self._output_fixed = True
                        elif mt == 'scientific': self._output_fixed = True
                        break
                    # Free operator<<(ostream&, ClassName): e.g. ostream& operator<<(ostream&, const Point&)
                    if (isinstance(val, dict) and val.get('kind') == 'struct'
                            and 'operator<<' in self.func_defs):
                        _cls = val.get('class', '')
                        _op_c = self.func_defs['operator<<']
                        _op_params = self._get_params(_op_c)
                        if len(_op_params) >= 2:
                            _p2_type = _op_params[1].type.spelling if _op_params[1].type else ''
                            if not _p2_type or _cls in _p2_type or 'auto' in _p2_type or not _cls:
                                self._call_user_function('operator<<', [{'kind': 'ostream'}, val], line)
                                break
                    text = self._val_to_output_text(val)
                    if text is not None and (text or text == '0'):
                        # Apply hex formatting
                        if self._output_hex and isinstance(val, dict) and val.get('kind') == 'int':
                            text = hex(val.get('value', 0))[2:]  # strip '0x' prefix
                        # Apply setw/setfill padding
                        w = self._output_width
                        self._output_width = 0  # reset after use
                        if w > len(text):
                            text = text.rjust(w, self._output_fill)
                        _disp = text.replace('\n', ' ').replace('\t', ' ').strip()
                        self._emit(line, f"Output: {_disp or '(newline)'}",
                                   {'type': 'output', 'text': text})
                    break
                return _INT(0)
            # ── user-defined operator<< on class objects (e.g. q << 1 << 2) ──
            _r = self._dispatch_user_stream_op(fn or 'operator<<', callee_c, ch, line)
            if _r is not None:
                return _r

        # ── cin >> var  (ch[0]=DECL_REF_EXPR 'cin', ch[1]=method-ref, ch[2]=target)
        #    Also handles chaining: (cin>>a)>>b where ch[0] is another CALL_EXPR
        if fn in ('operator>>', ''):
            def _is_cin_stream(c) -> bool:
                if c is None:
                    return False
                if c.kind == CK.DECL_REF_EXPR and c.spelling == 'cin':
                    return True
                if c.kind == CK.CALL_EXPR and c.spelling in ('operator>>', ''):
                    sub = self._ch(c)
                    return _is_cin_stream(sub[0] if sub else None)
                return False
            if _is_cin_stream(callee_c):
                # Evaluate left side first (handles chaining — cin >> a in cin >> a >> b)
                self._eval(callee_c)
                # Find the target variable cursor (skip method-ref slots)
                _read_ok = False
                for cand in ch[1:]:
                    sp = cand.spelling or ''
                    if cand.kind == CK.UNEXPOSED_EXPR and sp == 'operator>>':
                        continue  # method-ref slot — skip
                    real = (self._unwrap(cand) or cand) if cand.kind == CK.UNEXPOSED_EXPR else cand
                    type_spell = real.type.spelling if real.type else ''
                    _had_tokens = self._stdin_pos < len(self._stdin_tokens)
                    val = self._cin_read_next(type_spell)
                    self._write_lval(real, val, line)
                    _read_ok = _had_tokens
                    break
                # Return 1 (truthy) if read succeeded (for while(cin>>n) loops), 0 at EOF
                return _INT(1 if _read_ok else 0)
            # ── user-defined operator>> on class objects ──
            _r = self._dispatch_user_stream_op(fn or 'operator>>', callee_c, ch, line)
            if _r is not None:
                return _r

        # ── member-function / method call ──────────────────────────────────
        if callee_c and callee_c.kind == CK.MEMBER_REF_EXPR:
            method_name = callee_c.spelling
            if not method_name:
                # Dependent-type context: libclang leaves MEMBER_REF_EXPR.spelling empty.
                # Recover the method name from tokens: ['res', '.', 'back'] → 'back'
                mr_toks = [t.spelling for t in callee_c.get_tokens()]
                if '.' in mr_toks:
                    di = mr_toks.index('.')
                    if di + 1 < len(mr_toks):
                        method_name = mr_toks[di + 1]
                elif '->' in mr_toks:
                    di = mr_toks.index('->')
                    if di + 1 < len(mr_toks):
                        method_name = mr_toks[di + 1]
            if method_name in ('operator<<', 'operator>>'):
                mr_ch_tmp = self._ch(callee_c)
                is_cout = (mr_ch_tmp and
                           self._cursor_name(mr_ch_tmp[0]) in ('cout', 'cerr', 'std::cout', 'std::cerr'))
                is_cin = (mr_ch_tmp and
                          self._cursor_name(mr_ch_tmp[0]) in ('cin', 'std::cin'))
                if is_cout and method_name == 'operator<<':
                    arg_c = ch[1] if len(ch) > 1 else None
                    if arg_c:
                        val = self._eval(arg_c)
                        text = (val.get('value', '') if isinstance(val, dict) else str(val))
                        text = str(text).replace('\\n', '\n').replace('\\t', '\t')
                        _disp = text.replace('\n', ' ').replace('\t', ' ').strip()
                        self._emit(line, f"Output: {_disp or '(newline)'}",
                                   {'type': 'output', 'text': text})
                elif is_cin and method_name == 'operator>>':
                    arg_c = ch[1] if len(ch) > 1 else None
                    if arg_c:
                        type_spell = arg_c.type.spelling if arg_c.type else ''
                        val = self._cin_read_next(type_spell)
                        self._write_lval(arg_c, val, line)
                return _INT(0)
            if method_name in ('flush',):
                return _INT(0)
            mr_ch       = self._ch(callee_c)
            arg_cursors = ch[1:]
            args        = [self._eval(c) for c in arg_cursors]

            if not mr_ch or mr_ch[0].kind == CK.CXX_THIS_EXPR:
                return self._call_this_method(method_name, args, line,
                                              arg_cursors=arg_cursors)

            obj_c    = mr_ch[0]
            obj_type = obj_c.type.spelling if obj_c.type else ''
            obj_name = self._cursor_name(obj_c)

            # adj[u].push_back(v) / grid[0].size() — method on a subscripted element
            # obj_c may be wrapped in UNEXPOSED_EXPR, so unwrap before checking kind
            actual_obj_c = self._unwrap(obj_c) or obj_c
            if actual_obj_c.spelling == 'operator[]' and (
                actual_obj_c.kind == CK.CALL_EXPR or
                obj_c.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR)
            ):
                return self._call_method_on_subscript(actual_obj_c, method_name, args, line)
            # Raw C-array subscript: vector<int> adj[6]; adj[1].push_back(v)
            if actual_obj_c.kind == CK.ARRAY_SUBSCRIPT_EXPR:
                return self._call_method_on_c_array_subscript(actual_obj_c, method_name, args, line)

            if any(ct in obj_type for ct in ('queue', 'stack', 'deque', 'priority_queue')):
                return self._call_collection_method(obj_name, method_name, args, line)

            if self._is_vector_type(obj_type):
                return self._call_vector_method(obj_name, obj_c, method_name, args, line)

            if 'multiset<' in obj_type:
                return self._call_multiset_method(obj_name, method_name, args, line)

            if any(ct in obj_type for ct in ('map<', 'unordered_map<', 'set<', 'unordered_set<')):
                return self._call_map_method(obj_name, obj_type, method_name, args, line,
                                             arg_cursors=arg_cursors)

            base = self._base_type(obj_type)
            if base == 'string':
                return self._call_string_method(obj_name, obj_c, method_name, args, line)

            # Dependent / empty type: look up actual runtime value to route correctly
            if not base or 'dependent' in obj_type:
                try:
                    _rv = self.memory.get_var(obj_name) if obj_name else None
                except RuntimeError:
                    _rv = None
                if isinstance(_rv, dict):
                    _rk = _rv.get('kind')
                    if _rk == 'char':
                        return self._call_string_method(obj_name, obj_c, method_name, args, line)
                    if _rk == 'multiset':
                        return self._call_multiset_method(obj_name, method_name, args, line)
                    if _rk in ('set', 'map'):
                        return self._call_map_method(obj_name, _rv.get('label', _rk + '<int>'), method_name, args, line, arg_cursors=arg_cursors)
                    if _rk == 'array':
                        _ct = _rv.get('ctype', '')
                        if any(c in _ct for c in ('stack', 'queue', 'deque', 'priority_queue')):
                            return self._call_collection_method(obj_name, method_name, args, line)
                        return self._call_vector_method(obj_name, obj_c, method_name, args, line)
                    if _rk == 'pointer':
                        addr = _rv.get('address')
                        return self._call_method_on_heap(base, addr, method_name, args, line)

            if '*' in obj_type:
                obj_val = self._eval(obj_c)
                addr    = obj_val.get('address') if isinstance(obj_val, dict) else None
                return self._call_method_on_heap(base, addr, method_name, args, line)
            return self._call_method_on_stack(base, obj_name, obj_c, method_name, args, line,
                                             arg_cursors=arg_cursors)

        # ── class constructor call (fn is a class name) ────────────────────
        if fn in self.class_defs:
            args = [self._eval(c) for c in ch
                    if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
            # Copy construction: if arg is a struct of same class, prefer copy ctor
            if (len(args) == 1 and isinstance(args[0], dict) and args[0].get('kind') == 'struct'
                    and args[0].get('class') == fn):
                _copy_ctor = self._find_copy_ctor(fn)
                if _copy_ctor:
                    _cd = self.class_defs[fn]
                    _fields = {}
                    for _base in _cd.get('bases', []):
                        if _base in self.class_defs:
                            _fields.update({f: self._default_for_type(t)
                                            for f, t in self.class_defs[_base]['fields'].items()})
                    _fields.update({f: self._default_for_type(t) for f, t in _cd['fields'].items()})
                    _obj = {'kind': 'struct', 'fields': _fields, 'class': fn}
                    return self._run_ctor_on_stack_val(fn, _obj, _copy_ctor, args, line)
                return copy.deepcopy(args[0])
            return self._build_class_value(fn, args, line)

        # ── vector constructor (fn == 'vector' or type says vector) ────────
        if fn == 'vector' or self._is_vector_type(fn):
            type_spell = cursor.type.spelling or fn
            real_ch = [c for c in ch if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
            return self._init_vector(type_spell, real_ch, line)

        # ── pair constructor: CALL_EXPR 'pair' where ALL children are args ─
        # libclang represents {a,b} for pair<T,U> as CALL_EXPR 'pair' with no
        # callee slot — every child is a constructor argument.
        # Also handles pair copy-constructor: pair(pair_val) → return the pair.
        if fn == 'pair':
            real_ch = [c for c in ch if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
            args = [self._eval(c) for c in real_ch]
            # Copy constructor: single arg that is already a pair/struct
            if len(args) == 1 and isinstance(args[0], dict) and args[0].get('kind') == 'struct':
                return args[0]
            # Brace-init via initializer_list: single array arg with 2 elements → pair
            if (len(args) == 1 and isinstance(args[0], dict) and args[0].get('kind') == 'array'
                    and len(args[0].get('values', [])) == 2):
                v = args[0]['values']
                return self._make_pair(
                    _INT(int(v[0])) if isinstance(v[0], (int, float)) else v[0],
                    _INT(int(v[1])) if isinstance(v[1], (int, float)) else v[1],
                )
            return self._make_pair(
                args[0] if len(args) > 0 else _INT(0),
                args[1] if len(args) > 1 else _INT(0),
            )

        # ── string constructor: CALL_EXPR 'string' ─────────────────────────
        if fn == 'string':
            real_ch = [c for c in ch if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
            # string(n, c) — fill constructor
            if len(real_ch) == 2:
                n = self._to_int(self._eval(real_ch[0]))
                c_val = self._eval(real_ch[1])
                if isinstance(c_val, dict) and c_val.get('kind') == 'char':
                    c = c_val.get('value', '')
                else:
                    c = chr(self._to_int(c_val) & 0xFF)
                return {'kind': 'char', 'value': (c[0] if c else '') * n}
            if real_ch:
                val = self._eval(real_ch[0])
                if isinstance(val, dict) and val.get('kind') == 'char':
                    return val
                if isinstance(val, dict) and val.get('kind') == 'int':
                    return {'kind': 'char', 'value': ''}
            return {'kind': 'char', 'value': ''}

        # ── dependent-type method call recovery ───────────────────────────────
        # e.g. m.at("a"), s.contains(x) where type is '<dependent type>'.
        # AST: CALL_EXPR '' (UNEXPOSED_EXPR '' (DECL_REF_EXPR 'obj'), arg...)
        # Method name is not in any node — recover from tokens.
        if fn == '' and callee_c and callee_c.kind == CK.UNEXPOSED_EXPR:
            _actual = self._unwrap(callee_c) or callee_c
            if _actual and _actual.kind == CK.DECL_REF_EXPR and _actual.spelling:
                _obj_name = _actual.spelling
                # recover method name from tokens: ['obj', '.', 'method', '(', ...]
                _toks = [t.spelling for t in cursor.get_tokens()]
                _method = ''
                for _ti, _t in enumerate(_toks):
                    if _t in ('.', '->') and _ti + 1 < len(_toks):
                        _candidate = _toks[_ti + 1]
                        if _candidate not in ('', '(', ')'):
                            _method = _candidate
                            break
                if _method:
                    _arg_ch = ch[1:]
                    _args = [self._eval(c) for c in _arg_ch]
                    try:
                        _ov = self.memory.get_var(_obj_name)
                    except RuntimeError:
                        _ov = None
                    if isinstance(_ov, dict):
                        _ok = _ov.get('kind')
                        _ot = _ov.get('label', '')
                        if _ok == 'char':
                            return self._call_string_method(_obj_name, callee_c, _method, _args, line)
                        if _ok in ('set', 'map'):
                            return self._call_map_method(_obj_name, _ot or _ok + '<int>', _method, _args, line, arg_cursors=_arg_ch)
                        if _ok == 'array' or self._is_vector_type(_ot):
                            return self._call_vector_method(_obj_name, callee_c, _method, _args, line)
                        if _ok == 'multiset':
                            return self._call_multiset_method(_obj_name, _method, _args, line)

        # ── free function call ─────────────────────────────────────────────
        # ch[0] is the callee DECL_REF_EXPR (or UNEXPOSED_EXPR wrapping it)
        fn_name = fn
        if callee_c:
            actual = self._unwrap(callee_c) or callee_c
            if actual.kind == CK.DECL_REF_EXPR:
                if actual.spelling:
                    fn_name = actual.spelling
                else:
                    # Template functions (like sort, for_each) show up with an empty
                    # DECL_REF_EXPR spelling; the real name is in the OVERLOADED_DECL_REF
                    # child. Fall back to fn (cursor.spelling) if not found.
                    sub = self._ch(actual)
                    if sub and sub[0].kind == CK.OVERLOADED_DECL_REF and sub[0].spelling:
                        fn_name = sub[0].spelling
                    # else: fn_name stays as fn (from cursor.spelling)
        arg_ch = ch[1:] if (callee_c and callee_c.kind in
                            (CK.DECL_REF_EXPR, CK.UNEXPOSED_EXPR,
                             CK.MEMBER_REF_EXPR)) else ch
        # Filter out libclang-injected default arg expressions: they have source
        # locations outside user code (line == 0, or within stubs area).
        # Real user-provided args always land in user code (line > _STUBS_LINES).
        arg_ch = [c for c in arg_ch
                  if c.location.file and c.location.line > _STUBS_LINES]
        args = [self._eval(c) for c in arg_ch]
        return self._call_function(fn_name, args, line, arg_cursors=arg_ch)

    # ── operator[] read helper ───────────────────────────────────────────────
    # Structure: CALL_EXPR 'operator[]'
    #   ch[0]  = object  (array, MEMBER_REF_EXPR 'adj', or another operator[] call)
    #   ch[1]  = UNEXPOSED_EXPR 'operator[]'  (method ref — ignored)
    #   ch[-1] = index expression

    def _eval_subscript_call(self, cursor) -> dict:
        ch = self._ch(cursor)
        if len(ch) < 2:
            return _INT(0)
        obj_c = ch[0]
        idx_c = ch[-1]
        idx   = self._to_int(self._eval(idx_c))

        # 2-D: obj is itself an operator[] call
        actual_obj = self._unwrap(obj_c) or obj_c
        if actual_obj.kind == CK.CALL_EXPR and actual_obj.spelling == 'operator[]':
            och = self._ch(actual_obj)
            if len(och) >= 2:
                row = self._to_int(self._eval(och[-1]))
                arr_val = self._eval_member_or_var(och[0])
                vals = arr_val.get('values', []) if isinstance(arr_val, dict) else []
                try:
                    inner = vals[row]
                    # inner may be a plain list, a dict {kind:'array',...}, or a scalar
                    if isinstance(inner, dict) and inner.get('kind') == 'array':
                        inner_vals = inner.get('values', [])
                        cell = inner_vals[idx]
                        return cell if isinstance(cell, dict) else _INT(int(cell))
                    elif isinstance(inner, list):
                        cell = inner[idx]
                        return cell if isinstance(cell, dict) else _INT(int(cell))
                    else:
                        return _INT(int(inner))
                except (IndexError, TypeError, KeyError):
                    return _INT(0)

        # 1-D
        arr_val = self._eval_member_or_var(obj_c)
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'map':
            data = arr_val.get('data', {})
            raw_key = self._eval(idx_c)
            map_key = self._make_map_key(raw_key)
            return data.get(map_key, _INT(0))
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'char':
            s = arr_val.get('value', '')
            if 0 <= idx < len(s):
                return {'kind': 'char', 'value': s[idx]}
            return {'kind': 'char', 'value': ''}
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
            vals = arr_val.get('values', [])
            line = cursor.location.line
            if vals and not (0 <= idx < len(vals)):
                self._crash(line, 'out-of-bounds',
                            f"Index {idx} out of bounds for array of size {len(vals)}")
            try:
                cell = vals[idx]
                if isinstance(cell, dict):
                    return cell          # inner array dict (adjacency list element)
                if isinstance(cell, list):
                    return {'kind': 'array', 'values': cell}
                return _INT(int(cell))
            except (IndexError, TypeError):
                return _INT(0)
        return _INT(0)

    def _eval_member_or_var(self, cursor) -> dict:
        """Evaluate a cursor as an array value, handling implicit this->field."""
        actual = self._unwrap(cursor) or cursor
        if actual.kind == CK.MEMBER_REF_EXPR:
            field = actual.spelling
            ch    = self._ch(actual)
            if not ch or ch[0].kind == CK.CXX_THIS_EXPR:
                return self._read_this_field(field, actual.location.line) or {'kind': 'array', 'values': []}
        return self._eval(cursor)

    # ── new / delete ────────────────────────────────────────────────────────

    def _eval_new(self, cursor) -> dict:
        line       = cursor.location.line
        type_spell = cursor.type.spelling         # e.g. "Graph *"
        base       = self._base_type(type_spell)

        addr  = self.memory.malloc(base, line)
        block = self.memory.heap[addr]

        # Run constructor if we know this class
        if base in self.class_defs:
            cd  = self.class_defs[base]
            # Collect ctor args from the CXX_NEW_EXPR's CALL_EXPR child,
            # or values from INIT_LIST_EXPR for aggregate initialization (new Node{1, nullptr})
            ctor_args    = []
            init_values  = None
            for c in self._ch(cursor):
                if c.kind == CK.CALL_EXPR:
                    ctor_args = [self._eval(a) for a in self._ch(c)
                                 if a.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF,
                                                   CK.NAMESPACE_REF, CK.DECL_REF_EXPR)]
                    break
                elif c.kind == CK.INIT_LIST_EXPR:
                    init_values = [self._eval(a) for a in self._ch(c)]
                    break
            if cd['ctors']:
                self._run_ctor_on_heap(base, addr, cd['ctors'][0], ctor_args, line)
            elif init_values:
                # Aggregate init: positionally assign values to fields in declaration order
                field_names = list(cd['fields'].keys())
                for i, fv in enumerate(init_values):
                    if i < len(field_names):
                        self.memory.write_field(addr, field_names[i], fv, line)

        self.memory.update_line(line)
        self._emit(line, f"new {base} → {addr}.",
                   {'type': 'malloc', 'address': addr,
                    'size': block['size'], 'typeName': base})
        return {'kind': 'pointer', 'address': addr}

    def _eval_delete(self, cursor) -> dict:
        raw_line = cursor.location.line
        ch   = self._ch(cursor)
        if ch:
            ptr_val = self._eval(ch[0])
            addr    = ptr_val.get('address') if isinstance(ptr_val, dict) else None
            self.memory.free(addr, self._adj(raw_line))   # adjusted so freedAtLine is user-visible
            self.memory.update_line(raw_line)
            self._emit(raw_line, f"delete {addr}.",
                       {'type': 'free', 'address': addr})
        return _INT(0)

    # ── Init list / construct expr ──────────────────────────────────────────

    def _eval_init_list(self, cursor) -> dict:
        ch         = self._ch(cursor)
        type_spell = cursor.type.spelling if cursor.type else ''
        # {a, b} used as pair<T,U>
        if 'pair' in type_spell and len(ch) == 2:
            return self._make_pair(self._eval(ch[0]), self._eval(ch[1]))
        # 2D: all children are inner init lists → {{1,3,1},{1,5,1},{4,2,1}}
        if ch and all(c.kind == CK.INIT_LIST_EXPR for c in ch):
            rows = [[self._to_int(self._eval(e)) for e in self._ch(rc)] for rc in ch]
            n_rows = len(rows)
            n_cols = max((len(r) for r in rows), default=0)
            return {'kind': 'array', 'values': rows, 'rows': n_rows, 'cols': n_cols}
        vals = []
        for c in ch:
            v = self._eval(c)
            # Preserve non-numeric values (strings, structs, pointers) so that
            # vector<string>, vector<pair>, etc. store the correct element types.
            if isinstance(v, dict) and v.get('kind') in ('char', 'struct', 'pointer',
                                                          'array', 'map', 'set'):
                vals.append(v)
            else:
                vals.append(self._to_int(v))
        return {'kind': 'array', 'values': vals}

    def _make_pair(self, first, second) -> dict:
        return {'kind': 'struct', 'fields': {'first': first, 'second': second}}

    def _eval_construct_expr(self, cursor) -> dict:
        type_spell = cursor.type.spelling
        ch         = self._ch(cursor)

        if self._is_vector_type(type_spell):
            return self._init_vector(type_spell, ch, cursor.location.line)

        if 'pair' in type_spell:
            real_ch = [c for c in ch if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
            if len(real_ch) >= 2:
                return self._make_pair(self._eval(real_ch[0]), self._eval(real_ch[1]))
            return {'kind': 'struct', 'fields': {'first': _INT(0), 'second': _INT(0)}}

        base = self._base_type(type_spell)
        if base in self.class_defs:
            args = [self._eval(c) for c in ch]
            # Copy construction: `return C` or pass-by-value emits a single-arg
            # CXX_CONSTRUCT_EXPR for the implicit copy ctor.  Return a deep copy
            # of the source struct rather than zero-constructing a fresh object.
            if len(args) == 1 and isinstance(args[0], dict) and args[0].get('kind') == 'struct':
                return copy.deepcopy(args[0])
            return self._build_class_value(base, args, cursor.location.line)

        # Primitive: take first child if any
        if ch:
            return self._eval(ch[0])
        return self._default_for_type(type_spell)

    # ── LValue writes ───────────────────────────────────────────────────────

    def _write_lval(self, cursor, rval, line: int):
        """Write rval to whatever lvalue cursor represents."""
        if cursor is None:
            return
        k = cursor.kind

        if k in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR,
                 CK.CXX_STATIC_CAST_EXPR,
                 CK.CSTYLE_CAST_EXPR):
            ch = self._ch(cursor)
            if ch:
                self._write_lval(ch[0], rval, line)
            return

        if k == CK.DECL_REF_EXPR:
            name = cursor.spelling
            # Redirect write through reference variables
            try:
                existing = self.memory.get_var(name)
                if isinstance(existing, dict) and existing.get('kind') == 'ref':
                    target = existing['target']
                    self.memory.set_var(target, rval)
                    self.memory.update_line(line)
                    self._emit(line, f"{target} = {self._fmt(rval)}.",
                               {'type': 'assign', 'target': target, 'value': self._fmt(rval)})
                    return
            except RuntimeError:
                pass
            # Check if this is a local var or a this-field
            found_local = False
            for frame in reversed(self.memory.stack):
                if name in frame['variables']:
                    found_local = True
                    break
            if found_local:
                self.memory.set_var(name, rval)
                self.memory.update_line(line)
                self._emit(line, f"{name} = {self._fmt(rval)}.",
                           {'type': 'assign', 'target': name, 'value': self._fmt(rval)})
            elif self._this_stack:
                self._write_this_field(name, rval, line)
                self._emit(line, f"this->{name} = {self._fmt(rval)}.",
                           {'type': 'assign', 'target': name, 'value': self._fmt(rval)})
            return

        if k == CK.MEMBER_REF_EXPR:
            self._write_member_ref(cursor, rval, line)
            return

        if k == CK.ARRAY_SUBSCRIPT_EXPR:
            self._write_subscript(cursor, rval, line)
            return

        # operator[] write: CALL_EXPR 'operator[]' used as lvalue
        if k == CK.CALL_EXPR and cursor.spelling == 'operator[]':
            self._write_subscript_call(cursor, rval, line)
            return

        if k == CK.UNARY_OPERATOR:
            op = self._get_unary_op(cursor)
            if op == '*':
                ch = self._ch(cursor)
                if ch:
                    ptr_val = self._eval(ch[0])
                    addr    = ptr_val.get('address') if isinstance(ptr_val, dict) else None
                    self.memory.write_via_addr(addr, rval, line)
                    ptr_name = self._cursor_name(ch[0])
                    self.memory.update_line(line)
                    self._emit(line, f"*{ptr_name} = {self._fmt(rval)}.",
                               {'type': 'assign', 'target': f'*{ptr_name}',
                                'value': self._fmt(rval)})

    def _write_member_ref(self, cursor, rval, line: int):
        # NULL (defined as 0) assigned to a pointer field → coerce to null pointer
        field_type = cursor.type.spelling if cursor.type else ''
        if ('*' in field_type and isinstance(rval, dict) and rval.get('kind') == 'int'
                and rval.get('value') == 0):
            rval = {'kind': 'pointer', 'address': None}

        field = cursor.spelling or self._member_field_name(cursor)
        ch    = self._ch(cursor)

        if not ch or ch[0].kind == CK.CXX_THIS_EXPR:
            self._write_this_field(field, rval, line)
            self._emit(line, f"this->{field} = {self._fmt(rval)}.",
                       {'type': 'assign', 'target': f'this->{field}',
                        'value': self._fmt(rval)})
            return

        obj_c    = ch[0]
        obj_name = self._cursor_name(obj_c)
        obj_type = obj_c.type.spelling if obj_c.type else ''

        if '*' in obj_type:
            obj_val = self._eval(obj_c)
            addr    = obj_val.get('address') if isinstance(obj_val, dict) else None
            if addr:
                self.memory.write_field(addr, field, rval, line)
                self.memory.update_line(line)
                self._emit(line, f"{obj_name}->{field} = {self._fmt(rval)}.",
                           {'type': 'assign', 'target': f'{obj_name}->{field}',
                            'value': self._fmt(rval)})
        else:
            try:
                obj_val = self.memory.get_var(obj_name)
                if isinstance(obj_val, dict) and obj_val.get('kind') == 'struct':
                    obj_val['fields'][field] = rval
                    self.memory.set_var(obj_name, obj_val)
                    self.memory.update_line(line)
                    self._emit(line, f"{obj_name}.{field} = {self._fmt(rval)}.",
                               {'type': 'assign', 'target': f'{obj_name}.{field}',
                                'value': self._fmt(rval)})
            except RuntimeError:
                pass

    def _write_subscript(self, cursor, rval, line: int):
        """Write rval to arr[i] or arr[i][j]."""
        ch = self._ch(cursor)
        if len(ch) < 2:
            return
        arr_c, idx_c = ch[0], ch[1]
        idx = self._to_int(self._eval(idx_c))

        inner = self._unwrap(arr_c)
        if inner and inner.kind == CK.ARRAY_SUBSCRIPT_EXPR:
            # 2-D write
            ich = self._ch(inner)
            if len(ich) < 2:
                return
            row       = self._to_int(self._eval(ich[1]))
            arr_name, arr_val = self._resolve_array(ich[0], line)
            if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                v = self._arr_set(arr_val, [row, idx], rval, line)
                self._put_array(arr_name, ich[0], arr_val, line)
                lbl = arr_name or 'arr'
                self._emit(line, f"{lbl}[{row}][{idx}] = {v}.",
                           {'type': 'assign', 'target': f'{lbl}[{row}][{idx}]', 'value': str(v)})
            return

        # 1-D write
        arr_name, arr_val = self._resolve_array(arr_c, line)
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'array_ptr':
            # array_ptr: look up the underlying array and write through
            _real_name = arr_val.get('name', '')
            _base_idx  = arr_val.get('idx', 0)
            try:
                _real_arr = self.memory.get_var(_real_name)
                # If name lookup returned the array_ptr itself (same name in callee),
                # fall back to embedded data.
                if isinstance(_real_arr, dict) and _real_arr.get('kind') == 'array_ptr':
                    _real_arr = _real_arr.get('data')
            except RuntimeError:
                _real_arr = None
            if isinstance(_real_arr, dict) and _real_arr.get('kind') == 'array':
                _real_idx = _base_idx + idx
                v = self._arr_set(_real_arr, [_real_idx], rval, line)
                self.memory.set_var(_real_name, _real_arr)
                self.memory.update_line(line)
                self._emit(line, f"{_real_name}[{_real_idx}] = {v}.",
                           {'type': 'assign', 'target': f'{_real_name}[{_real_idx}]', 'value': str(v)})
            return
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
            v = self._arr_set(arr_val, [idx], rval, line)
            self._put_array(arr_name, arr_c, arr_val, line)
            lbl = arr_name or 'arr'
            self._emit(line, f"{lbl}[{idx}] = {v}.",
                       {'type': 'assign', 'target': f'{lbl}[{idx}]', 'value': str(v)})
            return
        # String subscript write: s[i] = c  (char-kind variables)
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'char':
            s = arr_val.get('value', '')
            if isinstance(rval, dict) and rval.get('kind') == 'char':
                new_ch = rval.get('value', '')[:1]
            else:
                c_int = self._to_int(rval)
                new_ch = chr(c_int) if 0 < c_int < 128 else ''
            if 0 <= idx < len(s):
                new_s = s[:idx] + new_ch + s[idx + 1:]
                arr_val['value'] = new_s
                self._put_array(arr_name, arr_c, arr_val, line)
                lbl = arr_name or 's'
                self._emit(line, f"{lbl}[{idx}] = '{new_ch}'.",
                           {'type': 'assign', 'target': f'{lbl}[{idx}]', 'value': new_ch})
            return
        # Pointer-subscript write: ptr[i] = val → store in heap block's _arr field
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'pointer':
            addr = arr_val.get('address')
            if addr and addr in self.memory.heap:
                block = self.memory.heap[addr]
                if block.get('state') == 'freed':
                    self._crash(line, 'use-after-free',
                                f"Use-after-free: writing to freed memory at {addr}")
                arr_field = block['fields'].get('_arr')
                if arr_field is None or arr_field.get('kind') != 'array':
                    arr_field = {'kind': 'array', 'values': []}
                    block['fields']['_arr'] = arr_field
                    block['fields'].pop('value', None)
                while len(arr_field['values']) <= idx:
                    arr_field['values'].append(0)
                v = self._arr_set(arr_field, [idx], rval, line)
                lbl = arr_name or 'ptr'
                self.memory.update_line(line)
                self._emit(line, f"{lbl}[{idx}] = {v}.",
                           {'type': 'assign', 'target': f'{lbl}[{idx}]', 'value': str(v)})

    def _write_subscript_call(self, cursor, rval, line: int):
        """Write via CALL_EXPR 'operator[]': obj[i] = val  or  obj[i][j] = val.
        Structure: ch[0]=object, ch[1]=method_ref(skip), ch[-1]=index."""
        ch = self._ch(cursor)
        if len(ch) < 2:
            return
        obj_c = ch[0]
        idx_c = ch[-1]
        idx   = self._to_int(self._eval(idx_c))

        # 2-D: obj_c is itself an operator[] call
        actual_obj = self._unwrap(obj_c) or obj_c
        if actual_obj.kind == CK.CALL_EXPR and actual_obj.spelling == 'operator[]':
            och = self._ch(actual_obj)
            if len(och) >= 2:
                row      = self._to_int(self._eval(och[-1]))
                base_c   = och[0]
                arr_name, arr_val = self._resolve_array(base_c, line)
                if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                    v = self._arr_set(arr_val, [row, idx], rval, line)
                    self._put_array(arr_name, base_c, arr_val, line)
                    lbl = arr_name or 'this->arr'
                    self._emit(line, f"{lbl}[{row}][{idx}] = {v}.",
                               {'type': 'assign', 'target': f'{lbl}[{row}][{idx}]', 'value': str(v)})
            return

        # 1-D
        arr_name, arr_val = self._resolve_array(obj_c, line)
        lbl = arr_name or 'arr'
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'map':
            data = arr_val.get('data', {})
            raw_key = self._eval(idx_c)
            map_key = self._make_map_key(raw_key)
            data[map_key] = rval
            arr_val['data'] = data
            if arr_name:
                self.memory.set_var(arr_name, arr_val)
            self._emit(line, f"{lbl}[{map_key}] = {self._fmt(rval)}.",
                       {'type': 'assign', 'target': f'{lbl}[{map_key}]',
                        'value': self._fmt(rval)})
            return
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
            v = self._arr_set(arr_val, [idx], rval, line)
            self._put_array(arr_name, obj_c, arr_val, line)
            self._emit(line, f"{lbl}[{idx}] = {v}.",
                       {'type': 'assign', 'target': f'{lbl}[{idx}]', 'value': str(v)})
            return
        # String operator[] write: s[i] = c
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'char':
            s = arr_val.get('value', '')
            if isinstance(rval, dict) and rval.get('kind') == 'char':
                new_ch = rval.get('value', '')[:1]
            else:
                c_int = self._to_int(rval)
                new_ch = chr(c_int) if 0 < c_int < 128 else ''
            if 0 <= idx < len(s):
                new_s = s[:idx] + new_ch + s[idx + 1:]
                arr_val['value'] = new_s
                if arr_name:
                    self.memory.set_var(arr_name, arr_val)
                self.memory.update_line(line)
                self._emit(line, f"{lbl}[{idx}] = '{new_ch}'.",
                           {'type': 'assign', 'target': f'{lbl}[{idx}]', 'value': new_ch})

    # ── Array resolution / storage ──────────────────────────────────────────

    def _resolve_array(self, cursor, line: int):
        """Return (name_or_None, array_dict_or_None) for a cursor pointing at an array."""
        if cursor is None:
            return None, None
        k = cursor.kind

        if k in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR):
            ch = self._ch(cursor)
            return self._resolve_array(ch[0], line) if ch else (None, None)

        if k == CK.DECL_REF_EXPR:
            name = cursor.spelling
            try:
                return name, self.memory.get_var(name)
            except RuntimeError:
                # Might be a this-field
                if self._this_stack:
                    val = self._read_this_field(name, line)
                    if val is not None:
                        return name, val
            return name, None

        if k == CK.MEMBER_REF_EXPR:
            field = cursor.spelling
            ch    = self._ch(cursor)
            if not ch or ch[0].kind == CK.CXX_THIS_EXPR:
                return None, self._read_this_field(field, line)
            obj_val = self._eval(ch[0])
            if isinstance(obj_val, dict) and obj_val.get('kind') == 'struct':
                obj_name = self._cursor_name(ch[0])
                return f'__struct:{obj_name}:{field}', obj_val['fields'].get(field)
            if isinstance(obj_val, dict) and obj_val.get('kind') == 'pointer':
                addr = obj_val.get('address')
                if addr and addr in self.memory.heap:
                    block = self.memory.heap[addr]
                    if block.get('state') == 'allocated':
                        import copy as _copy
                        return f'__heap:{addr}:{field}', _copy.deepcopy(block['fields'].get(field))
        return None, None

    def _put_array(self, arr_name, arr_cursor, arr_val, line: int):
        """Write the (mutated) array back to its storage location."""
        if arr_name and arr_name.startswith('__heap:'):
            _, addr, field = arr_name.split(':', 2)
            if addr in self.memory.heap:
                self.memory.heap[addr]['fields'][field] = arr_val
            return
        if arr_name and arr_name.startswith('__struct:'):
            _, obj_name, field = arr_name.split(':', 2)
            for frame in reversed(self.memory.stack):
                if obj_name in frame['variables']:
                    obj_val = frame['variables'][obj_name]
                    if isinstance(obj_val, dict) and obj_val.get('kind') == 'struct':
                        obj_val['fields'][field] = arr_val
                    return
            if self._this_stack:
                obj_val = self._read_this_field(obj_name, line)
                if isinstance(obj_val, dict) and obj_val.get('kind') == 'struct':
                    obj_val['fields'][field] = arr_val
                    self._write_this_field(obj_name, obj_val, line)
            return
        if arr_name:
            # Check if it's in local scope first
            found = False
            for frame in reversed(self.memory.stack):
                if arr_name in frame['variables']:
                    frame['variables'][arr_name] = arr_val
                    found = True
                    break
            if not found and self._this_stack:
                self._write_this_field(arr_name, arr_val, line)
        elif self._this_stack and arr_cursor:
            field = self._member_field_name(arr_cursor)
            if field:
                self._write_this_field(field, arr_val, line)

    def _member_field_name(self, cursor) -> str:
        """Extract field name from a MEMBER_REF_EXPR (possibly wrapped).
        Falls back to token-based recovery for template dependent types where
        libclang leaves spelling empty."""
        if cursor is None:
            return ''
        k = cursor.kind
        if k in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR):
            ch = self._ch(cursor)
            return self._member_field_name(ch[0]) if ch else ''
        if k == CK.MEMBER_REF_EXPR:
            if cursor.spelling:
                return cursor.spelling
            # Dependent type: recover from tokens  n -> field  or  obj . field
            toks = [t.spelling for t in cursor.get_tokens()]
            for i, t in enumerate(toks):
                if t in ('->', '.') and i + 1 < len(toks):
                    return toks[i + 1]
        return ''

    # ── Reference parameter write-back helpers ───────────────────────────────

    def _ref_target_name(self, cursor) -> str:
        """Return the variable name that a ref-arg cursor refers to, or ''."""
        while cursor and cursor.kind == CK.UNEXPOSED_EXPR:
            ch = self._ch(cursor)
            cursor = ch[0] if ch else None
        if cursor and cursor.kind == CK.DECL_REF_EXPR:
            return cursor.spelling
        # CALL_EXPR returning T&: propagate through to find the ref'd variable.
        # e.g. preinc(preinc(x)) — outer arg is CALL_EXPR 'preinc', its ref param
        # points to x. We follow the chain so the outer writeback updates x too.
        if cursor and cursor.kind == CK.CALL_EXPR:
            fn = cursor.spelling
            if fn and fn in self.func_defs:
                fn_c = self.func_defs[fn]
                ret_type = fn_c.result_type.spelling if fn_c.result_type else ''
                if '&' in ret_type and '*' not in ret_type:
                    # Find first ref-typed param's arg cursor
                    params = self._get_params(fn_c)
                    arg_ch = self._ch(cursor)[1:]  # skip callee
                    for pi, param in enumerate(params):
                        pts = param.type.spelling if param.type else ''
                        if '&' in pts and '*' not in pts and pi < len(arg_ch):
                            return self._ref_target_name(arg_ch[pi])
        return ''

    def _setup_ref_writeback(self, params, arg_cursors, caller_frame_idx) -> list:
        """Build [(param_name, caller_fi, caller_var)] for every & param we can resolve."""
        if not arg_cursors:
            return []
        result = []
        for i, param in enumerate(params):
            ts = param.type.spelling
            if '&' not in ts or '*' in ts:   # skip non-reference and pointer types
                continue
            if i >= len(arg_cursors):
                continue
            var_name = self._ref_target_name(arg_cursors[i])
            if var_name and caller_frame_idx >= 0:
                result.append((param.spelling, caller_frame_idx, var_name))
        return result

    def _apply_ref_writeback(self, ref_wb: list):
        """Copy callee's ref-param values back to caller's variables (before pop_frame)."""
        if not ref_wb or not self.memory.stack:
            return
        callee_vars = self.memory.stack[-1]['variables']
        for param_name, caller_fi, caller_var in ref_wb:
            if param_name not in callee_vars:
                continue
            if caller_fi >= len(self.memory.stack):
                continue
            caller_frame = self.memory.stack[caller_fi]
            if caller_var in caller_frame['variables']:
                caller_frame['variables'][caller_var] = callee_vars[param_name]

    # ── Function call dispatchers ────────────────────────────────────────────

    def _call_function(self, fn_name: str, args: list, line: int, arg_cursors=None) -> dict:
        # Stored lambda invocation
        if fn_name in self._lambda_store:
            return self._call_stored_lambda(fn_name, args, line)

        # Built-ins — scanf / gets / fgets: read from stdin and write to pointer args
        if fn_name in ('scanf', 'fscanf') and arg_cursors:
            return self._exec_scanf(arg_cursors, line)

        if fn_name in ('gets', 'fgets') and arg_cursors:
            # Read one line token into the first arg variable
            token = self._stdin_tokens[self._stdin_pos] if self._stdin_pos < len(self._stdin_tokens) else ''
            self._stdin_pos += 1
            inner = self._scanf_inner_cursor(arg_cursors[0])
            if inner is not None:
                self._write_lval(inner, {'kind': 'char', 'value': token}, line)
            return _INT(1)

        # printf / puts / putchar: emit output to trace
        if fn_name in ('printf', 'fprintf') and args:
            fmt_arg = arg_cursors[0] if arg_cursors else None
            # For fprintf, skip the FILE* first arg (stream handle)
            if fn_name == 'fprintf' and len(args) > 1:
                args = args[1:]
                fmt_arg = arg_cursors[1] if arg_cursors and len(arg_cursors) > 1 else None
            # args[0] is the format string itself; pass only the value args
            text = self._exec_printf(fmt_arg, args[1:])
            if text:
                self._emit(line, text, {'type': 'output', 'text': text})
            return _INT(len(text) if text else 0)

        if fn_name == 'puts' and args:
            text = self._val_to_output_text(args[0]) + '\n'
            self._emit(line, text, {'type': 'output', 'text': text})
            return _INT(0)

        if fn_name == 'putchar' and args:
            ch = chr(self._to_int(args[0])) if isinstance(self._to_int(args[0]), int) else ''
            self._emit(line, ch, {'type': 'output', 'text': ch})
            return _INT(self._to_int(args[0]))

        if fn_name in ('setw', 'std::setw') and args:
            return {'kind': 'manip', 'mtype': 'setw', 'value': int(self._to_int(args[0]))}
        if fn_name in ('setfill', 'std::setfill') and args:
            v = args[0]
            ch_val = v.get('value', ' ') if isinstance(v, dict) and v.get('kind') == 'char' else ' '
            return {'kind': 'manip', 'mtype': 'setfill', 'value': ch_val}
        if fn_name in ('setprecision', 'std::setprecision') and args:
            return {'kind': 'manip', 'mtype': 'setprecision', 'value': int(self._to_int(args[0]))}
        if fn_name in ('fixed', 'std::fixed', 'scientific', 'std::scientific'):
            return {'kind': 'manip', 'mtype': fn_name.split('::')[-1]}
        if fn_name in ('sprintf', 'cout', 'print', 'cin', 'fgets'):
            return _INT(0)
        if fn_name == 'exit':
            raise ReturnException(args[0] if args else _INT(0))
        if fn_name == 'assert' and args:
            cond = self._to_int(args[0])
            if not cond:
                expr_text = (arg_cursors[0].spelling if arg_cursors else 'condition')
                self._emit(line, f"Assertion failed: {expr_text}",
                           {'type': 'crash', 'reason': f'assert({expr_text}) failed'})
                raise SegFaultError('assert', f'assert({expr_text}) failed', line=line)
            return _INT(0)
        if fn_name in ('abs', 'std::abs', 'fabs', 'std::fabs') and args:
            v = self._to_int(args[0])
            return _FLOAT(abs(float(v))) if _is_float_val(args[0]) else _INT(abs(int(v)))
        if fn_name in ('sqrt', 'std::sqrt') and args:
            import math
            v = self._to_int(args[0])
            return _FLOAT(math.sqrt(max(float(v), 0.0)))
        if fn_name in ('floor', 'std::floor') and args:
            import math
            return _FLOAT(math.floor(self._to_int(args[0])))
        if fn_name in ('ceil', 'std::ceil') and args:
            import math
            return _FLOAT(math.ceil(self._to_int(args[0])))
        if fn_name in ('pow', 'std::pow') and len(args) >= 2:
            import math
            return _FLOAT(math.pow(self._to_int(args[0]), self._to_int(args[1])))
        if fn_name in ('log', 'std::log') and args:
            import math
            v = self._to_int(args[0])
            return _FLOAT(math.log(float(v)) if v > 0 else 0.0)
        if fn_name in ('log2', 'std::log2') and args:
            import math
            v = self._to_int(args[0])
            return _FLOAT(math.log2(float(v)) if v > 0 else 0.0)
        if fn_name in ('sin', 'std::sin', 'cos', 'std::cos', 'tan', 'std::tan') and args:
            import math
            v = float(self._to_int(args[0]))
            fn_map = {'sin': math.sin, 'std::sin': math.sin, 'cos': math.cos, 'std::cos': math.cos,
                      'tan': math.tan, 'std::tan': math.tan}
            return _FLOAT(fn_map[fn_name](v))
        if fn_name in ('atan', 'std::atan', 'atan2', 'std::atan2') and args:
            import math
            v = float(self._to_int(args[0]))
            if fn_name in ('atan2', 'std::atan2') and len(args) >= 2:
                return _FLOAT(math.atan2(v, float(self._to_int(args[1]))))
            return _FLOAT(math.atan(v))
        if fn_name in ('round', 'std::round') and args:
            import math
            return _FLOAT(round(float(self._to_int(args[0]))))
        if fn_name in ('min', 'std::min'):
            if len(args) >= 2:
                a0, a1 = self._to_int(args[0]), self._to_int(args[1])
                res = min(a0, a1)
                return _FLOAT(float(res)) if (_is_float_val(args[0]) or _is_float_val(args[1])) else _INT(int(res))
            if len(args) == 1 and isinstance(args[0], dict) and args[0].get('kind') == 'array':
                vals = args[0].get('values', [])
                return _INT(min(self._to_int(v) for v in vals)) if vals else _INT(0)
            return _INT(0)
        if fn_name in ('max', 'std::max'):
            if len(args) >= 2:
                a0, a1 = self._to_int(args[0]), self._to_int(args[1])
                res = max(a0, a1)
                return _FLOAT(float(res)) if (_is_float_val(args[0]) or _is_float_val(args[1])) else _INT(int(res))
            if len(args) == 1 and isinstance(args[0], dict) and args[0].get('kind') == 'array':
                vals = args[0].get('values', [])
                return _INT(max(self._to_int(v) for v in vals)) if vals else _INT(0)
            return _INT(0)
        if fn_name == 'swap' and len(args) >= 2 and fn_name not in self.func_defs:
            val_a = copy.deepcopy(args[0])
            val_b = copy.deepcopy(args[1])
            if arg_cursors and len(arg_cursors) >= 2:
                uw0 = self._unwrap(arg_cursors[0]) or arg_cursors[0]
                uw1 = self._unwrap(arg_cursors[1]) or arg_cursors[1]
                # Detect if both sides are subscript accesses (C-array or vector operator[])
                def _subscript_parts(uw):
                    if uw.kind == CK.ARRAY_SUBSCRIPT_EXPR:
                        ch = self._ch(uw)
                        if len(ch) >= 2:
                            return ch[0].spelling, ch[1]
                    if uw.kind == CK.CALL_EXPR and uw.spelling == 'operator[]':
                        ch = self._ch(uw)
                        if len(ch) >= 2:
                            # For vector/string operator[], ch[0] is the object
                            try:
                                n, _ = self._resolve_array(ch[0], 0)
                                return n, ch[-1]
                            except Exception:
                                return ch[0].spelling, ch[-1]
                    return None, None
                n0, idx_c0 = _subscript_parts(uw0)
                n1, idx_c1 = _subscript_parts(uw1)
                if n0 and n0 == n1 and idx_c0 is not None and idx_c1 is not None:
                    try:
                        idx0 = self._to_int(self._eval(idx_c0))
                        idx1 = self._to_int(self._eval(idx_c1))
                        arr  = self.memory.get_var(n0)
                        if isinstance(arr, dict) and arr.get('kind') == 'array':
                            vals = arr.get('values', [])
                            if 0 <= idx0 < len(vals) and 0 <= idx1 < len(vals):
                                vals[idx0], vals[idx1] = vals[idx1], vals[idx0]
                                arr['values']    = vals
                                arr['lastWrite'] = [idx0, idx1]  # dual-highlight
                                self.memory.set_var(n0, arr)
                                self.memory.update_line(line)
                                self._emit(line,
                                           f"swap({n0}[{idx0}], {n0}[{idx1}]).",
                                           {'type': 'assign', 'target': n0,
                                            'value': f'swap [{idx0}]↔[{idx1}]'})
                                return _INT(0)
                    except Exception:
                        pass
                # Generic fallback: write each side separately
                self._write_lval(arg_cursors[0], val_b, line)
                self._write_lval(arg_cursors[1], val_a, line)
            return _INT(0)
        if fn_name in ('sort', 'std::sort', 'stable_sort') and arg_cursors:
            return self._sort_with_comparator(fn_name, arg_cursors, line)
        if fn_name in ('reverse', 'std::reverse') and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            if arr_name:
                try:
                    arr_val = self.memory.get_var(arr_name)
                    if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                        arr_val['values'].reverse()
                        self.memory.set_var(arr_name, arr_val)
                        self._emit(line, f'reverse({arr_name}).',
                                   {'type': 'assign', 'target': arr_name, 'value': 'reversed'})
                    elif isinstance(arr_val, dict) and arr_val.get('kind') == 'char':
                        new_val = {'kind': 'char', 'value': arr_val.get('value', '')[::-1]}
                        self.memory.set_var(arr_name, new_val)
                        self._emit(line, f'reverse({arr_name}).',
                                   {'type': 'assign', 'target': arr_name, 'value': 'reversed'})
                except RuntimeError:
                    pass
            return _INT(0)
        if fn_name in ('max_element', 'std::max_element') and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            if arr_name:
                try:
                    arr_val = self.memory.get_var(arr_name)
                    if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                        vals = [self._to_int(v) for v in arr_val.get('values', [])]
                        if vals:
                            return _INT(max(vals))
                except RuntimeError:
                    pass
            return _INT(0)
        if fn_name in ('min_element', 'std::min_element') and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            if arr_name:
                try:
                    arr_val = self.memory.get_var(arr_name)
                    if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                        vals = [self._to_int(v) for v in arr_val.get('values', [])]
                        if vals:
                            return _INT(min(vals))
                except RuntimeError:
                    pass
            return _INT(0)
        if fn_name in ('accumulate', 'std::accumulate'):
            init_val = self._to_int(args[2]) if len(args) > 2 else 0
            if arg_cursors:
                arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
                if arr_name:
                    try:
                        arr_val = self.memory.get_var(arr_name)
                        if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                            total = init_val + sum(self._to_int(v) for v in arr_val.get('values', []))
                            return _INT(total)
                    except RuntimeError:
                        pass
            return _INT(init_val)
        if fn_name in ('lower_bound', 'std::lower_bound', 'upper_bound', 'std::upper_bound'):
            if arg_cursors:
                arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
                target = self._to_int(args[2]) if len(args) > 2 else 0
                if arr_name:
                    try:
                        arr_val = self.memory.get_var(arr_name)
                        if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                            vals = sorted(self._to_int(v) for v in arr_val.get('values', []))
                            import bisect
                            if 'lower' in fn_name:
                                return _INT(bisect.bisect_left(vals, target))
                            return _INT(bisect.bisect_right(vals, target))
                    except RuntimeError:
                        pass
            return _INT(0)
        if fn_name in ('isdigit', 'std::isdigit') and args:
            c = self._to_int(args[0])
            return _INT(int(chr(c).isdigit()) if 0 <= c <= 127 else 0)
        if fn_name in ('isalpha', 'std::isalpha') and args:
            c = self._to_int(args[0])
            return _INT(int(chr(c).isalpha()) if 0 <= c <= 127 else 0)
        if fn_name in ('isalnum', 'std::isalnum') and args:
            c = self._to_int(args[0])
            return _INT(int(chr(c).isalnum()) if 0 <= c <= 127 else 0)
        if fn_name in ('isspace', 'std::isspace') and args:
            c = self._to_int(args[0])
            return _INT(int(chr(c).isspace()) if 0 <= c <= 127 else 0)
        if fn_name in ('isupper', 'std::isupper') and args:
            c = self._to_int(args[0])
            return _INT(int(chr(c).isupper()) if 0 <= c <= 127 else 0)
        if fn_name in ('islower', 'std::islower') and args:
            c = self._to_int(args[0])
            return _INT(int(chr(c).islower()) if 0 <= c <= 127 else 0)
        if fn_name in ('ispunct', 'std::ispunct') and args:
            c = self._to_int(args[0])
            return _INT(int(chr(c) in '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~') if 0 <= c <= 127 else 0)
        if fn_name in ('toupper', 'std::toupper') and args:
            c = self._to_int(args[0])
            return _INT(ord(chr(c).upper()) if 0 <= c <= 127 else c)
        if fn_name in ('tolower', 'std::tolower') and args:
            c = self._to_int(args[0])
            return _INT(ord(chr(c).lower()) if 0 <= c <= 127 else c)
        if fn_name in ('to_string', 'std::to_string') and args:
            return {'kind': 'char', 'value': str(self._to_int(args[0]))}
        if fn_name in ('stoi', 'std::stoi') and args:
            sv = args[0].get('value', '0') if isinstance(args[0], dict) else str(args[0])
            try:
                return _INT(int(sv.strip()))
            except (ValueError, AttributeError):
                self._crash(line, 'invalid-argument',
                            f"stoi: no valid integer in string \"{sv.strip()}\"")
        if fn_name in ('stoll', 'std::stoll') and args:
            sv = args[0].get('value', '0') if isinstance(args[0], dict) else str(args[0])
            try:
                return _INT(int(sv.strip()))
            except (ValueError, AttributeError):
                self._crash(line, 'invalid-argument',
                            f"stoll: no valid integer in string \"{sv.strip()}\"")
        if fn_name in ('stoul', 'std::stoul', 'stoull', 'std::stoull') and args:
            sv = args[0].get('value', '0') if isinstance(args[0], dict) else str(args[0])
            try:
                return _INT(int(sv.strip()))
            except (ValueError, AttributeError):
                self._crash(line, 'invalid-argument',
                            f"stoul: no valid integer in string \"{sv.strip()}\"")
        if fn_name in ('stof', 'std::stof', 'stod', 'std::stod', 'stold', 'std::stold') and args:
            sv = args[0].get('value', '0') if isinstance(args[0], dict) else str(args[0])
            try:
                return {'kind': 'float', 'value': float(sv.strip())}
            except (ValueError, AttributeError):
                self._crash(line, 'invalid-argument',
                            f"stof: no valid number in string \"{sv.strip()}\"")
        if fn_name in ('to_wstring', 'std::to_wstring') and args:
            return {'kind': 'char', 'value': str(self._to_int(args[0]))}

        # ── gcd / lcm ────────────────────────────────────────────────────
        if fn_name in ('gcd', 'std::gcd', '__gcd', 'lcm', 'std::lcm') and len(args) >= 2:
            import math as _math
            a = self._to_int(args[0])
            b = self._to_int(args[1])
            if 'lcm' in fn_name:
                result = 0 if a == 0 or b == 0 else abs(a * b) // _math.gcd(abs(a), abs(b))
            else:
                result = _math.gcd(abs(a), abs(b))
            return _INT(result)

        # ── __builtin_popcount / clz / ctz ───────────────────────────────
        if fn_name == '__builtin_popcount' and args:
            n = self._to_int(args[0]) & 0xFFFFFFFF
            return _INT(bin(n).count('1'))
        if fn_name == '__builtin_clz' and args:
            n = self._to_int(args[0]) & 0xFFFFFFFF
            if n == 0:
                return _INT(32)
            return _INT(31 - (n.bit_length() - 1))
        if fn_name == '__builtin_ctz' and args:
            n = self._to_int(args[0]) & 0xFFFFFFFF
            if n == 0:
                return _INT(32)
            count = 0
            while n & 1 == 0:
                count += 1
                n >>= 1
            return _INT(count)

        # ── fill / iota ─────────────────────────────────────────────────
        if fn_name in ('fill', 'std::fill') and len(args) >= 3 and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            fill_val = args[2] if len(args) > 2 else _INT(0)
            if arr_name:
                try:
                    arr = self.memory.get_var(arr_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        n = len(arr.get('values', []))
                        arr['values'] = [self._to_int(fill_val)] * n
                        arr['lastWrite'] = [n - 1] if n else []
                        self.memory.set_var(arr_name, arr)
                        self.memory.update_line(line)
                        self._emit(line, f"fill({arr_name}, {self._fmt(fill_val)}).",
                                   {'type': 'assign', 'target': arr_name,
                                    'value': self._fmt(fill_val)})
                except RuntimeError:
                    pass
            return _INT(0)
        if fn_name in ('iota', 'std::iota') and len(args) >= 3 and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            start_val = self._to_int(args[2]) if len(args) > 2 else 0
            if arr_name:
                try:
                    arr = self.memory.get_var(arr_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        n = len(arr.get('values', []))
                        arr['values'] = list(range(start_val, start_val + n))
                        arr['lastWrite'] = [n - 1] if n else []
                        self.memory.set_var(arr_name, arr)
                        self.memory.update_line(line)
                        self._emit(line, f"iota({arr_name}, {start_val}).",
                                   {'type': 'assign', 'target': arr_name,
                                    'value': str(start_val)})
                except RuntimeError:
                    pass
            return _INT(0)

        # ── count (algorithm) ───────────────────────────────────────────
        if fn_name in ('count', 'std::count') and len(args) >= 3 and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            target   = self._to_int(args[2]) if len(args) > 2 else 0
            if arr_name:
                try:
                    arr = self.memory.get_var(arr_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        return _INT(sum(1 for v in arr.get('values', [])
                                       if self._to_int(v) == target))
                except RuntimeError:
                    pass
            return _INT(0)

        # ── next_permutation / prev_permutation ─────────────────────────
        if fn_name in ('next_permutation', 'std::next_permutation',
                       'prev_permutation', 'std::prev_permutation') and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            if arr_name:
                try:
                    arr = self.memory.get_var(arr_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        vals = [self._to_int(v) for v in arr.get('values', [])]
                        import itertools as _it
                        if 'next' in fn_name:
                            # Find the next permutation manually
                            i = len(vals) - 2
                            while i >= 0 and vals[i] >= vals[i + 1]:
                                i -= 1
                            if i < 0:
                                vals.sort()
                                arr['values'] = vals
                                self.memory.set_var(arr_name, arr)
                                self._emit(line, f"next_permutation({arr_name}) → false (wrapped).",
                                           {'type': 'assign', 'target': arr_name, 'value': 'perm'})
                                return _INT(0)  # false: wrapped around
                            j = len(vals) - 1
                            while vals[j] <= vals[i]:
                                j -= 1
                            vals[i], vals[j] = vals[j], vals[i]
                            vals[i + 1:] = vals[i + 1:][::-1]
                        else:
                            # prev_permutation
                            i = len(vals) - 2
                            while i >= 0 and vals[i] <= vals[i + 1]:
                                i -= 1
                            if i < 0:
                                vals.sort(reverse=True)
                                arr['values'] = vals
                                self.memory.set_var(arr_name, arr)
                                self._emit(line, f"prev_permutation({arr_name}) → false (wrapped).",
                                           {'type': 'assign', 'target': arr_name, 'value': 'perm'})
                                return _INT(0)  # false
                            j = len(vals) - 1
                            while vals[j] >= vals[i]:
                                j -= 1
                            vals[i], vals[j] = vals[j], vals[i]
                            vals[i + 1:] = vals[i + 1:][::-1]
                        arr['values'] = vals
                        self.memory.set_var(arr_name, arr)
                        self.memory.update_line(line)
                        verb = 'next_permutation' if 'next' in fn_name else 'prev_permutation'
                        self._emit(line, f"{verb}({arr_name}).",
                                   {'type': 'assign', 'target': arr_name, 'value': 'perm'})
                        return _INT(1)  # true: permutation exists
                except RuntimeError:
                    pass
            return _INT(0)

        # ── make_heap / push_heap / pop_heap ────────────────────────────
        if fn_name in ('make_heap', 'std::make_heap',
                       'push_heap', 'std::push_heap',
                       'pop_heap',  'std::pop_heap') and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            if arr_name:
                try:
                    arr = self.memory.get_var(arr_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        import heapq as _hq
                        vals = [self._to_int(v) for v in arr.get('values', [])]
                        if 'make_heap' in fn_name:
                            _hq.heapify(vals)
                            vals = [-x for x in sorted([-x for x in vals])]  # max-heap order
                            # Simply sort descending for max-heap visual
                            vals.sort(reverse=True)
                        elif 'push_heap' in fn_name:
                            vals.sort(reverse=True)
                        elif 'pop_heap' in fn_name:
                            if vals:
                                # Move max to end, re-sort the rest
                                vals.sort(reverse=True)
                                # The user typically calls pop_back after pop_heap
                                # We just re-sort for display; actual pop_back removes it
                        arr['values'] = vals
                        arr['lastWrite'] = [0] if vals else []
                        self.memory.set_var(arr_name, arr)
                        self.memory.update_line(line)
                        verb = fn_name.replace('std::', '')
                        self._emit(line, f"{verb}({arr_name}).",
                                   {'type': 'assign', 'target': arr_name, 'value': 'heap'})
                except RuntimeError:
                    pass
            return _INT(0)

        # ── binary_search ────────────────────────────────────────────────
        if fn_name in ('binary_search', 'std::binary_search') and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            target = args[2] if len(args) > 2 else _INT(0)
            if arr_name:
                try:
                    arr_val = self.memory.get_var(arr_name)
                    if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                        import bisect as _bs
                        vals = [self._to_int(v) for v in arr_val.get('values', [])]
                        t = self._to_int(target)
                        pos = _bs.bisect_left(vals, t)
                        return _INT(1 if pos < len(vals) and vals[pos] == t else 0)
                except RuntimeError:
                    pass
            return _INT(0)

        # ── rotate ───────────────────────────────────────────────────────
        if fn_name in ('rotate', 'std::rotate') and arg_cursors and len(arg_cursors) >= 2:
            arr_name, k = self._sort_ptr_info(arg_cursors[1])
            if arr_name is None:
                arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
                k = 0
            if arr_name and k is not None and k > 0:
                try:
                    arr_val = self.memory.get_var(arr_name)
                    if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                        vals = list(arr_val.get('values', []))
                        n = len(vals)
                        rk = k % n if n else 0
                        if rk:
                            arr_val['values'] = vals[rk:] + vals[:rk]
                            arr_val['lastWrite'] = [0]
                            self.memory.set_var(arr_name, arr_val)
                            self.memory.update_line(line)
                            self._emit(line, f"rotate({arr_name}, {rk}).",
                                       {'type': 'assign', 'target': arr_name, 'value': 'rotated'})
                except RuntimeError:
                    pass
            return _INT(0)

        # ── unique ───────────────────────────────────────────────────────
        if fn_name in ('unique', 'std::unique') and arg_cursors:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            if arr_name:
                try:
                    arr_val = self.memory.get_var(arr_name)
                    if isinstance(arr_val, dict) and arr_val.get('kind') == 'array':
                        vals = arr_val.get('values', [])
                        new_vals: list = []
                        for v in vals:
                            if not new_vals or self._to_int(v) != self._to_int(new_vals[-1]):
                                new_vals.append(v)
                        unique_n = len(new_vals)
                        arr_val['values'] = new_vals + list(vals[unique_n:])
                        arr_val['lastWrite'] = [unique_n - 1] if new_vals else []
                        self.memory.set_var(arr_name, arr_val)
                        self.memory.update_line(line)
                        self._emit(line, f"unique({arr_name}) → {unique_n} unique.",
                                   {'type': 'assign', 'target': arr_name,
                                    'value': f'unique[{unique_n}]'})
                        return {'kind': 'iterator', 'data': arr_val.get('values', []),
                                'idx': unique_n}
                except RuntimeError:
                    pass
            return _INT(0)

        # ── distance / advance ───────────────────────────────────────────
        if fn_name in ('distance', 'std::distance') and len(args) >= 2:
            it = args[1]
            if isinstance(it, dict) and it.get('kind') == 'iterator':
                idx = it.get('idx')
                if idx is None:
                    return _INT(len(it.get('data', [])))
                return _INT(idx)
            return _INT(self._to_int(it))
        if fn_name in ('advance', 'std::advance') and len(args) >= 2 and arg_cursors:
            it = args[0]
            n  = self._to_int(args[1])
            if isinstance(it, dict) and it.get('kind') == 'iterator':
                idx = it.get('idx')
                if idx is not None:
                    self._write_lval(arg_cursors[0], {**it, 'idx': idx + n}, line)
            return _INT(0)

        # ── transform ────────────────────────────────────────────────────
        if fn_name in ('transform', 'std::transform') and arg_cursors and len(arg_cursors) >= 3:
            src_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            # 4-arg form: transform(s.begin, s.end, d.begin, op) — unary op on src → dst
            # 3-arg form: transform(begin, end, begin2, op) or transform(begin, end, out, op)
            # We handle the common unary-transform-in-place pattern (src == dst)
            op_cursor = arg_cursors[3] if len(arg_cursors) >= 4 else (
                arg_cursors[2] if len(arg_cursors) == 3 else None)
            if src_name and op_cursor is not None:
                try:
                    arr = self.memory.get_var(src_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        vals = arr.get('values', [])
                        new_vals = []
                        for v in vals:
                            result = self._call_function_value(op_cursor, [v], line)
                            new_vals.append(result if result is not None else v)
                        arr['values'] = new_vals
                        arr['lastWrite'] = [len(new_vals) - 1] if new_vals else []
                        self.memory.set_var(src_name, arr)
                        self.memory.update_line(line)
                        self._emit(line, f"transform({src_name}).",
                                   {'type': 'assign', 'target': src_name, 'value': 'transformed'})
                except (RuntimeError, Exception):
                    pass
            return _INT(0)

        # ── any_of / all_of / none_of ────────────────────────────────────
        if fn_name in ('any_of', 'std::any_of',
                       'all_of', 'std::all_of',
                       'none_of', 'std::none_of') and arg_cursors and len(arg_cursors) >= 3:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            pred_cursor = arg_cursors[2]
            if arr_name:
                try:
                    arr = self.memory.get_var(arr_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        vals = arr.get('values', [])
                        results = []
                        for v in vals:
                            r = self._call_function_value(pred_cursor, [v], line)
                            results.append(self._truthy(r))
                        base = fn_name.replace('std::', '')
                        if base == 'any_of':  return _INT(int(any(results)))
                        if base == 'all_of':  return _INT(int(all(results)))
                        if base == 'none_of': return _INT(int(not any(results)))
                except (RuntimeError, Exception):
                    pass
            return _INT(0)

        # ── find_if / count_if ───────────────────────────────────────────
        if fn_name in ('find_if', 'std::find_if',
                       'find_if_not', 'std::find_if_not') and arg_cursors and len(arg_cursors) >= 3:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            pred_cursor = arg_cursors[2]
            if arr_name:
                try:
                    arr = self.memory.get_var(arr_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        vals = arr.get('values', [])
                        invert = 'not' in fn_name
                        for i, v in enumerate(vals):
                            r = self._call_function_value(pred_cursor, [v], line)
                            match = self._truthy(r)
                            if invert: match = not match
                            if match:
                                return {'kind': 'iterator', 'data': vals, 'idx': i}
                        return {'kind': 'iterator', 'data': vals, 'idx': None}
                except (RuntimeError, Exception):
                    pass
            return _INT(0)
        if fn_name in ('count_if', 'std::count_if') and arg_cursors and len(arg_cursors) >= 3:
            arr_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            pred_cursor = arg_cursors[2]
            if arr_name:
                try:
                    arr = self.memory.get_var(arr_name)
                    if isinstance(arr, dict) and arr.get('kind') == 'array':
                        vals = arr.get('values', [])
                        cnt = sum(1 for v in vals
                                  if self._truthy(self._call_function_value(pred_cursor, [v], line)))
                        return _INT(cnt)
                except (RuntimeError, Exception):
                    pass
            return _INT(0)

        # ── copy / copy_if ───────────────────────────────────────────────
        if fn_name in ('copy', 'std::copy') and arg_cursors and len(arg_cursors) >= 3:
            src_name = self._find_arr_from_begin_cursor(arg_cursors[0])
            dst_name = self._find_arr_from_begin_cursor(arg_cursors[2])
            if src_name and dst_name and src_name != dst_name:
                try:
                    src = self.memory.get_var(src_name)
                    dst = self.memory.get_var(dst_name)
                    if (isinstance(src, dict) and src.get('kind') == 'array' and
                            isinstance(dst, dict) and dst.get('kind') == 'array'):
                        import copy as _cp
                        dst['values'] = list(_cp.deepcopy(src.get('values', [])))
                        dst['lastWrite'] = [len(dst['values']) - 1] if dst['values'] else []
                        self.memory.set_var(dst_name, dst)
                        self.memory.update_line(line)
                        self._emit(line, f"copy({src_name} → {dst_name}).",
                                   {'type': 'assign', 'target': dst_name, 'value': 'copied'})
                except (RuntimeError, Exception):
                    pass
            return _INT(0)

        if fn_name in ('make_pair', 'std::make_pair') and len(args) >= 2:
            return self._make_pair(args[0], args[1])
        if fn_name == 'pair' and len(args) >= 2:
            return self._make_pair(args[0], args[1])
        if fn_name in ('strlen', 'std::strlen') and args:
            sv = args[0].get('value', '') if isinstance(args[0], dict) else ''
            if isinstance(sv, str):
                return _INT(len(sv.rstrip('\0')))
            if isinstance(args[0], dict) and args[0].get('kind') == 'array':
                # char array stored as int array — count non-zero elements
                vals = args[0].get('values', [])
                count = sum(1 for v in vals if self._to_int(v) != 0)
                return _INT(count)
            return _INT(0)

        if fn_name in ('strcpy', 'std::strcpy') and len(args) >= 2 and arg_cursors:
            src = args[1].get('value', '') if isinstance(args[1], dict) else ''
            dest_c = arg_cursors[0] if arg_cursors else None
            if dest_c is not None:
                self._write_lval(dest_c, {'kind': 'char', 'value': src}, line)
            return args[0] if args else _INT(0)

        if fn_name in ('strcat', 'std::strcat') and len(args) >= 2 and arg_cursors:
            dest_val = args[0]
            src_val = args[1]
            ds = dest_val.get('value', '') if isinstance(dest_val, dict) else ''
            ss = src_val.get('value', '') if isinstance(src_val, dict) else ''
            new_val = {'kind': 'char', 'value': ds + ss}
            dest_c = arg_cursors[0] if arg_cursors else None
            if dest_c is not None:
                self._write_lval(dest_c, new_val, line)
            return args[0] if args else _INT(0)

        if fn_name in ('strcmp', 'std::strcmp') and len(args) >= 2:
            ls = args[0].get('value', '') if isinstance(args[0], dict) else ''
            rs = args[1].get('value', '') if isinstance(args[1], dict) else ''
            if ls < rs: return _INT(-1)
            if ls > rs: return _INT(1)
            return _INT(0)

        if fn_name in ('atoi', 'std::atoi') and args:
            sv = args[0].get('value', '0') if isinstance(args[0], dict) else '0'
            try:
                return _INT(int(str(sv).strip()))
            except (ValueError, AttributeError):
                return _INT(0)

        if fn_name in ('memcpy', 'std::memcpy') and len(args) >= 3 and arg_cursors:
            src_val = args[1] if len(args) > 1 else _INT(0)
            dest_c = arg_cursors[0] if arg_cursors else None
            if dest_c is not None and isinstance(src_val, dict):
                self._write_lval(dest_c, src_val, line)
            return args[0] if args else _INT(0)

        if fn_name in ('memset', 'std::memset') and len(args) >= 3 and arg_cursors:
            fill = self._to_int(args[1]) & 0xFF
            n = self._to_int(args[2])
            dest_c = arg_cursors[0] if arg_cursors else None
            dest_val = args[0] if args else None
            if isinstance(dest_val, dict) and dest_val.get('kind') == 'array':
                vals = dest_val.get('values', [])
                for i in range(min(n, len(vals))):
                    vals[i] = fill
            elif dest_c is not None:
                # Try to write a filled string
                self._write_lval(dest_c, {'kind': 'char', 'value': chr(fill) * n if fill else '\0' * n}, line)
            return args[0] if args else _INT(0)

        if fn_name == 'malloc' and args:
            size  = self._to_int(args[0])
            # Try to extract struct type from sizeof(TypeName) argument
            struct_name = 'unknown'
            if arg_cursors:
                import re as _re
                # Get actual source text via tokens (cursor.spelling is empty for sizeof exprs)
                try:
                    tok = ' '.join(t.spelling for t in arg_cursors[0].get_tokens())
                except Exception:
                    tok = ''
                m = _re.search(r'sizeof\s*\(\s*(?:struct\s+|class\s+)?(\w+)\s*\)', tok)
                if m and m.group(1) in self.class_defs:
                    struct_name = m.group(1)
                else:
                    # Fallback: walk cursor tree for TYPE_REF or child type spellings
                    def _find_type_ref(cur):
                        for c in self._ch(cur):
                            if c.kind == CK.TYPE_REF:
                                name = c.spelling.replace('struct ', '').replace('class ', '').strip()
                                if name in self.class_defs:
                                    return name
                            if hasattr(c, 'type') and c.type and c.type.spelling:
                                t = c.type.spelling
                                name = t.replace('struct ', '').replace('class ', '').replace('*', '').strip()
                                if name in self.class_defs:
                                    return name
                            found = _find_type_ref(c)
                            if found:
                                return found
                        return None
                    candidate = _find_type_ref(arg_cursors[0])
                    if candidate:
                        struct_name = candidate
            addr  = self.memory.malloc(struct_name, line)
            block = self.memory.heap[addr]
            if struct_name == 'unknown':
                n_elems = max(1, size // 4) if size > 0 else 1
                block['fields'] = {'_arr': {'kind': 'array', 'values': [0] * n_elems}}
            block['size'] = size
            self._emit(line, f"malloc({size}B) → {addr}.",
                       {'type': 'malloc', 'address': addr,
                        'size': size, 'typeName': struct_name})
            return {'kind': 'pointer', 'address': addr}
        if fn_name == 'free' and args:
            addr = args[0].get('address') if isinstance(args[0], dict) else None
            self.memory.free(addr, self._adj(line))   # adjusted so freedAtLine is user-visible
            self.memory.update_line(line)
            self._emit(line, f"free({addr}).", {'type': 'free', 'address': addr})
            return _INT(0)

        # User function
        if fn_name in self.func_defs:
            return self._call_user_function(fn_name, args, line, arg_cursors=arg_cursors)

        # Function pointer: fn_name is a variable holding {'kind': 'funcptr', 'name': f}
        try:
            _fptr = self.memory.get_var(fn_name)
            if isinstance(_fptr, dict) and _fptr.get('kind') == 'funcptr':
                _real = _fptr.get('name', '')
                if _real in self.func_defs:
                    return self._call_user_function(_real, args, line, arg_cursors=arg_cursors)
        except RuntimeError:
            pass

        return _INT(0)

    def _find_arr_from_begin_cursor(self, cursor) -> str | None:
        """Extract variable name from v.begin() CALL_EXPR or plain v DECL_REF_EXPR.
        Also handles MEMBER_REF_EXPR 'begin' directly (template contexts where
        libclang omits the CALL_EXPR wrapper)."""
        if cursor is None:
            return None
        uw = self._unwrap(cursor) or cursor
        if uw.kind == CK.DECL_REF_EXPR:
            return uw.spelling
        if uw.kind == CK.CALL_EXPR:
            for bc in self._ch(uw):
                obj = self._unwrap(bc) or bc
                if obj.kind == CK.MEMBER_REF_EXPR:
                    mrch = self._ch(obj)
                    if mrch:
                        base = mrch[0]
                        while base and base.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR):
                            ch2 = self._ch(base)
                            base = ch2[0] if ch2 else None
                        if base and base.kind == CK.DECL_REF_EXPR:
                            return base.spelling
        # MEMBER_REF_EXPR directly (no CALL_EXPR wrapper in dependent type contexts)
        if uw.kind == CK.MEMBER_REF_EXPR:
            mrch = self._ch(uw)
            if mrch:
                base = mrch[0]
                while base and base.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR):
                    ch2 = self._ch(base)
                    base = ch2[0] if ch2 else None
                if base and base.kind == CK.DECL_REF_EXPR:
                    return base.spelling
        return None

    def _sort_ptr_array_name(self, cursor):
        """Walk an expression tree to find the leftmost array DECL_REF_EXPR name."""
        if cursor is None:
            return None
        uw = self._unwrap(cursor) or cursor
        if uw.kind == CK.DECL_REF_EXPR:
            return uw.spelling
        if uw.kind == CK.BINARY_OPERATOR:
            bch = self._ch(uw)
            if bch:
                return self._sort_ptr_array_name(bch[0])
        if uw.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR):
            bch = self._ch(uw)
            if bch:
                return self._sort_ptr_array_name(bch[0])
        return None

    def _sort_ptr_offset(self, cursor, arr_name: str) -> int:
        """Compute the numeric offset in `arr + expr` by evaluating only the non-array parts."""
        if cursor is None:
            return 0
        uw = self._unwrap(cursor) or cursor
        # Skip the array itself
        if uw.kind == CK.DECL_REF_EXPR and uw.spelling == arr_name:
            return 0
        # Binary + or -: recurse on both sides
        if uw.kind == CK.BINARY_OPERATOR:
            bch = self._ch(uw)
            if len(bch) >= 2:
                lv = self._sort_ptr_offset(bch[0], arr_name)
                try:
                    rv = self._to_int(self._eval(bch[1]))
                except Exception:
                    rv = 0
                return lv + rv
        # Anything else: try to evaluate directly as a scalar
        try:
            return self._to_int(self._eval(cursor))
        except Exception:
            return 0

    def _sort_ptr_info(self, cursor):
        """Given a sort begin/end cursor, return (arr_name, offset) for pointer-arithmetic
        form `arr + k`, `arr + n + 1`, or plain `arr` / `arr.begin()`."""
        if cursor is None:
            return None, 0
        uw = self._unwrap(cursor) or cursor
        # DECL_REF_EXPR: plain `arr` → offset 0
        if uw.kind == CK.DECL_REF_EXPR:
            return uw.spelling, 0
        # BINARY_OPERATOR: could be `arr + k` or `(arr + n) + 1`
        if uw.kind == CK.BINARY_OPERATOR:
            name = self._sort_ptr_array_name(uw)
            if name:
                # Compute offset by summing non-array parts of the expression tree
                offset = self._sort_ptr_offset(uw, name)
                return name, offset
        # CALL_EXPR for v.begin() / v.end()
        bch = self._ch(uw)
        for bc in bch:
            obj = self._unwrap(bc) or bc
            if obj.kind == CK.MEMBER_REF_EXPR:
                mrch = self._ch(obj)
                if mrch:
                    base = mrch[0]
                    while base and base.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR):
                        ch2 = self._ch(base)
                        base = ch2[0] if ch2 else None
                    if base and base.kind == CK.DECL_REF_EXPR:
                        return base.spelling, None  # None = end sentinel (use len)
        return None, 0

    def _sort_with_comparator(self, fn_name: str, arg_cursors: list, line: int) -> dict:
        """Handle sort(begin, end) or sort(begin, end, cmp) calls.
        Supports both v.begin()/v.end() and C-style pointer arithmetic (arr+k)."""
        arr_name  = None
        arr_val   = None
        slice_lo  = 0
        slice_hi  = None  # None = use full length

        if len(arg_cursors) >= 2:
            begin_name, lo = self._sort_ptr_info(arg_cursors[0])
            end_name,   hi = self._sort_ptr_info(arg_cursors[1])
            if begin_name and begin_name == end_name:
                arr_name = begin_name
                try:
                    arr_val = self.memory.get_var(arr_name)
                except RuntimeError:
                    pass
                slice_lo = lo if lo is not None else 0
                slice_hi = hi  # None means end() → set to len below
            elif begin_name and lo is not None:
                # Fallback: begin from begin_name
                arr_name = begin_name
                try:
                    arr_val = self.memory.get_var(arr_name)
                except RuntimeError:
                    pass
                slice_lo = lo
                slice_hi = hi

        # sort(s.begin(), s.end()) — char-kind string
        if isinstance(arr_val, dict) and arr_val.get('kind') == 'char' and arr_name:
            s = arr_val.get('value', '')
            sorted_s = ''.join(sorted(s))
            self.memory.set_var(arr_name, {'kind': 'char', 'value': sorted_s})
            self._emit(line, f'sort({arr_name}).',
                       {'type': 'assign', 'target': arr_name, 'value': sorted_s})
            return _INT(0)

        if not isinstance(arr_val, dict) or arr_val.get('kind') != 'array':
            return _INT(0)

        vals = arr_val.get('values', [])
        if not vals:
            return _INT(0)

        # Resolve slice bounds
        lo = slice_lo if slice_lo is not None else 0
        hi = slice_hi if slice_hi is not None else len(vals)
        lo = max(0, min(lo, len(vals)))
        hi = max(lo, min(hi, len(vals)))
        slice_to_sort = vals[lo:hi]

        # Find the comparator lambda (3rd arg cursor, kind == LAMBDA_EXPR)
        lambda_c = None
        for ac in arg_cursors[2:]:
            uw = self._unwrap(ac) or ac
            if uw.kind == CK.LAMBDA_EXPR:
                lambda_c = uw
                break

        if lambda_c is None:
            # No comparator — natural sort (ascending for ints, lex for pairs/strings)
            def key_fn(elem):
                if isinstance(elem, dict):
                    k = elem.get('kind')
                    if k == 'struct':
                        fields = elem.get('fields', {})
                        fk = fields.get('first', _INT(0))
                        sk = fields.get('second', _INT(0))
                        # String-keyed pairs (map iteration): sort by string first key
                        if isinstance(fk, dict) and fk.get('kind') == 'char':
                            return (fk.get('value', ''), self._to_int(sk))
                        return (self._to_int(fk), self._to_int(sk))
                    if k == 'char':
                        return elem.get('value', '')
                if isinstance(elem, list):
                    return 0
                return self._to_int(elem)
            slice_to_sort.sort(key=key_fn)
        else:
            # Execute lambda to compare two elements
            lch = self._ch(lambda_c)
            params = [c for c in lch if c.kind == CK.PARM_DECL]
            body   = next((c for c in lch if c.kind == CK.COMPOUND_STMT), None)

            if body and len(params) >= 2:
                import functools
                def compare(a, b):
                    self.memory.push_frame('<lambda>', line)
                    p0_name = params[0].spelling
                    p1_name = params[1].spelling
                    a_val = ({'kind': 'array', 'values': list(a)} if isinstance(a, list)
                             else (_INT(a) if isinstance(a, int) else a))
                    b_val = ({'kind': 'array', 'values': list(b)} if isinstance(b, list)
                             else (_INT(b) if isinstance(b, int) else b))
                    self.memory.declare_var(p0_name, a_val)
                    self.memory.declare_var(p1_name, b_val)
                    result = _INT(0)
                    try:
                        self._exec_compound(body)
                    except ReturnException as e:
                        result = e.value if e.value is not None else _INT(0)
                    finally:
                        self.memory.pop_frame()
                    return -1 if self._truthy(result) else 1

                try:
                    slice_to_sort.sort(key=functools.cmp_to_key(compare))
                except Exception:
                    pass

        # Write the sorted slice back
        vals[lo:hi] = slice_to_sort
        arr_val['values'] = vals
        if arr_name:
            self.memory.set_var(arr_name, arr_val)

        self._emit(line, f'sort({arr_name}).',
                   {'type': 'assign', 'target': arr_name or 'arr', 'value': 'sorted'})
        return _INT(0)

    def _call_stored_lambda(self, name: str, args: list, line: int) -> dict:
        """Invoke a lambda stored via auto f = [&](...){ ... }."""
        lambda_c = self._lambda_store.get(name)
        if lambda_c is None:
            return _INT(0)
        lch = self._ch(lambda_c)
        params = [c for c in lch if c.kind == CK.PARM_DECL]
        body = next((c for c in lch if c.kind == CK.COMPOUND_STMT), None)
        if not body:
            return _INT(0)
        frame_name = f'<lambda:{name}>'
        self.memory.push_frame(frame_name, line)
        for param, arg_val in zip(params, args):
            if param.spelling:
                self.memory.declare_var(param.spelling, arg_val)
        # Emit call step so the lambda frame appears in the visualization
        arg_strs = [self._fmt(a) for a in args[:6]]
        self._emit(line, f"Call {name}({', '.join(arg_strs)}).",
                   {'type': 'call', 'function': frame_name, 'args': arg_strs})
        ret_val = _INT(0)
        try:
            self._exec_compound(body)
        except ReturnException as r:
            ret_val = r.value if r.value is not None else _INT(0)
        # Emit return step while frame is still on stack so it's visible
        self._emit(line, f"{name} returned {self._fmt(ret_val)}.",
                   {'type': 'return', 'function': frame_name, 'value': self._fmt(ret_val)})
        self.memory.pop_frame()
        return ret_val if ret_val is not None else _INT(0)

    def _call_function_value(self, cursor, args: list, line: int) -> dict:
        """Call a callable from a cursor (lambda expr, stored lambda name, or user function).
        Used by transform, any_of, all_of, none_of, find_if, count_if."""
        if cursor is None:
            return _INT(0)
        uw = self._unwrap(cursor) or cursor

        # Direct lambda expression
        if uw.kind == CK.LAMBDA_EXPR:
            lch = self._ch(uw)
            params = [c for c in lch if c.kind == CK.PARM_DECL]
            body   = next((c for c in lch if c.kind == CK.COMPOUND_STMT), None)
            if not body:
                return _INT(0)
            self.memory.push_frame('<lambda>', line)
            for param, arg_val in zip(params, args):
                if param.spelling:
                    self.memory.declare_var(param.spelling, arg_val)
            ret_val = _INT(0)
            try:
                self._exec_compound(body)
            except ReturnException as r:
                ret_val = r.value if r.value is not None else _INT(0)
            finally:
                self.memory.pop_frame()
            return ret_val

        # Reference to a stored lambda or user function
        if uw.kind == CK.DECL_REF_EXPR:
            name = uw.spelling
            if name in self._lambda_store:
                return self._call_stored_lambda(name, args, line)
            if name in self.func_defs:
                return self._call_user_function(name, args, line)

        # Unexposed / paren: recurse
        if uw.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR):
            ch = self._ch(uw)
            if ch:
                return self._call_function_value(ch[0], args, line)

        return _INT(0)

    def _call_user_function(self, fn_name: str, args: list, line: int,
                            arg_cursors=None) -> dict:
        if len(self.memory.stack) >= MAX_CALL_DEPTH:
            self._crash(line, 'stack-overflow',
                        f"Stack overflow: call depth exceeded {MAX_CALL_DEPTH} frames "
                        f"(infinite recursion in {fn_name}?)")
        fn_cursor = self.func_defs[fn_name]
        self.memory.update_line(line)
        arg_strs = [self._fmt(a) for a in args[:6]]
        self._emit(line, f"Calling {fn_name}({', '.join(arg_strs)}).",
                   {'type': 'call', 'function': fn_name, 'args': arg_strs})
        self.memory.push_frame(fn_name, line)

        params = self._get_params(fn_cursor)
        caller_fi = len(self.memory.stack) - 2
        ref_wb = self._setup_ref_writeback(params, arg_cursors, caller_fi)

        for _pi, (param, arg_val) in enumerate(zip(params, args)):
            if param.spelling:
                # Array-to-pointer decay: C-array passed to pointer parameter
                _pt = param.type.spelling if param.type else ''
                if (isinstance(arg_val, dict) and arg_val.get('kind') == 'array'
                        and ('*' in _pt or '[' in _pt)):
                    _arr_name = ''
                    if arg_cursors and _pi < len(arg_cursors):
                        _ac = self._unwrap(arg_cursors[_pi]) or arg_cursors[_pi]
                        _arr_name = _ac.spelling if _ac else ''
                    # Embed actual array data so 2D indexing works inside the callee
                    # (the parameter name shadows the caller's variable, so name-based
                    # lookup would find the array_ptr itself, not the original array).
                    arg_val = {'kind': 'array_ptr', 'name': _arr_name, 'idx': 0,
                               'data': arg_val}
                self.memory.declare_var(param.spelling, arg_val)
        # Fill in default arguments for any unprovided params
        for _pi in range(len(args), len(params)):
            param = params[_pi]
            if param.spelling:
                _pch = [c for c in self._ch(param)
                        if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
                if _pch:
                    _default_val = self._eval(_pch[0])
                else:
                    _default_val = self._default_for_type(
                        param.type.spelling if param.type else '')
                self.memory.declare_var(param.spelling, _default_val)

        ret_val = None
        try:
            self._exec_compound(self._body_of(fn_cursor))
        except ReturnException as r:
            ret_val = r.value

        # Missing return in non-void function (#34)
        if ret_val is None:
            try:
                ret_type = fn_cursor.result_type.spelling if fn_cursor.result_type else ''
                if ret_type and 'void' not in ret_type and ret_type not in ('', 'auto'):
                    self._warn(line, 'missing-return',
                               f"Function '{fn_name}' has return type '{ret_type}' but no return "
                               f"statement was reached — returning 0 by default. "
                               f"Check all code paths have an explicit return.")
            except Exception:
                pass

        self._apply_ref_writeback(ref_wb)
        # Save static local variable values before popping the frame
        if fn_name in self._static_frame_keys:
            for svar in self._static_frame_keys[fn_name]:
                try:
                    self._static_vars[(fn_name, svar)] = self.memory.get_var(svar)
                except RuntimeError:
                    pass
        # Call destructors for local struct variables (reverse order)
        self._call_frame_destructors(line)
        self.memory.pop_frame()
        self._emit(line, f"Returning from {fn_name}().",
                   {'type': 'return', 'function': fn_name,
                    'value': self._fmt(ret_val) if ret_val is not None else 'void'})
        return ret_val if ret_val is not None else _INT(0)

    def _dispatch_user_stream_op(self, op_name: str, callee_c, ch: list, line: int):
        """Dispatch user-defined operator<< / operator>> on class objects.
        Returns the result dict (with '_self' annotation for chaining) or None if not applicable.
        """
        obj_name = None
        actual = self._unwrap(callee_c) or callee_c if callee_c else None
        if actual and actual.kind == CK.DECL_REF_EXPR:
            obj_name = actual.spelling
        elif callee_c and callee_c.kind == CK.CALL_EXPR and callee_c.spelling in ('operator<<', 'operator>>', ''):
            inner_r = self._eval(callee_c)
            if isinstance(inner_r, dict) and '_self' in inner_r:
                obj_name = inner_r['_self']
        if not obj_name:
            return None
        try: _ov = self.memory.get_var(obj_name)
        except: return None
        if not (isinstance(_ov, dict) and _ov.get('kind') == 'struct'):
            return None
        _cn = _ov.get('class', '')
        if not _cn or _cn not in self.class_defs:
            return None
        if op_name not in self.class_defs[_cn].get('methods', {}):
            return None
        real_c = [c for c in ch[1:]
                  if not (c.kind == CK.UNEXPOSED_EXPR and c.spelling in ('operator<<', 'operator>>'))]
        _res = self._call_method_on_stack(_cn, obj_name, None, op_name,
                                          [self._eval(c) for c in real_c], line,
                                          arg_cursors=real_c)
        if isinstance(_res, dict):
            return {**_res, '_self': obj_name}
        return {'kind': 'int', 'value': self._to_int(_res), '_self': obj_name}

    def _call_frame_destructors(self, line: int):
        """Call destructors for local struct variables in the top frame (reverse order)."""
        if not self.memory.stack:
            return
        frame = self.memory.stack[-1]
        # Collect names of stack vars that are user-defined struct/class instances
        dtor_vars = []
        for var_name, val in frame['variables'].items():
            if not isinstance(val, dict) or val.get('kind') != 'struct':
                continue
            class_name = val.get('class', '')
            if not class_name or class_name not in self.class_defs:
                continue
            cd = self.class_defs[class_name]
            dtor_name = '~' + class_name
            if dtor_name in cd.get('methods', {}):
                dtor_vars.append((var_name, class_name))
        for var_name, class_name in reversed(dtor_vars):
            try:
                self._call_method_on_stack(class_name, var_name, None, '~' + class_name, [], line)
            except Exception:
                pass

    def _resolve_virtual_method(self, static_class: str, obj_class: str, method_name: str):
        """Return (class_name, method_cursor) for virtual dispatch."""
        # If the actual runtime class has the method, prefer it (virtual dispatch)
        if obj_class and obj_class in self.class_defs:
            _ocd = self.class_defs[obj_class]
            if method_name in _ocd['methods']:
                return obj_class, _ocd['methods'][method_name]
            # Walk up the inheritance chain of the actual class
            for _base in _ocd.get('bases', []):
                if _base in self.class_defs and method_name in self.class_defs[_base]['methods']:
                    return _base, self.class_defs[_base]['methods'][method_name]
        # Fall back to static class
        if static_class in self.class_defs:
            _scd = self.class_defs[static_class]
            if method_name in _scd['methods']:
                return static_class, _scd['methods'][method_name]
            for _base in _scd.get('bases', []):
                if _base in self.class_defs and method_name in self.class_defs[_base]['methods']:
                    return _base, self.class_defs[_base]['methods'][method_name]
        return None, None

    def _call_method_on_stack(self, class_name: str, obj_name: str, obj_c,
                              method_name: str, args: list, line: int,
                              arg_cursors=None) -> dict:
        if class_name not in self.class_defs:
            return _INT(0)

        # Find the frame containing obj_name
        frame_idx = None
        for i in reversed(range(len(self.memory.stack))):
            if obj_name in self.memory.stack[i]['variables']:
                frame_idx = i
                break
        if frame_idx is None:
            return _INT(0)

        # Virtual dispatch: get actual runtime class from the object's value
        obj_val = self.memory.stack[frame_idx]['variables'].get(obj_name, {})
        actual_class = obj_val.get('class', class_name) if isinstance(obj_val, dict) else class_name
        resolved_class, method_cursor = self._resolve_virtual_method(class_name, actual_class, method_name)
        if method_cursor is None:
            return _INT(0)

        binding = _ThisBinding('stack', frame_idx=frame_idx, var_name=obj_name,
                               class_name=resolved_class)
        self._this_stack.append(binding)
        result = self._call_method_body(resolved_class, method_name,
                                        method_cursor, args, line,
                                        arg_cursors=arg_cursors)
        self._this_stack.pop()
        return result

    def _call_method_on_heap(self, class_name: str, addr,
                             method_name: str, args: list, line: int,
                             arg_cursors=None) -> dict:
        if addr is None:
            self._crash(line, 'null-deref',
                        f"Null pointer dereference: calling {method_name}() on nullptr")
        if class_name not in self.class_defs:
            return _INT(0)
        cd = self.class_defs[class_name]
        if method_name not in cd['methods']:
            return _INT(0)

        binding = _ThisBinding('heap', addr=addr, class_name=class_name)
        self._this_stack.append(binding)
        result = self._call_method_body(class_name, method_name,
                                        cd['methods'][method_name], args, line,
                                        arg_cursors=arg_cursors)
        self._this_stack.pop()
        return result

    def _call_this_method(self, method_name: str, args: list, line: int,
                          arg_cursors=None) -> dict:
        if not self._this_stack:
            return _INT(0)
        binding    = self._this_stack[-1]
        class_name = self._binding_class_name(binding)
        if not class_name or class_name not in self.class_defs:
            return _INT(0)
        # Get actual runtime class for virtual dispatch
        actual_class = class_name
        if binding.kind == 'stack' and binding.frame_idx is not None:
            _ov = self.memory.stack[binding.frame_idx]['variables'].get(binding.var_name, {})
            if isinstance(_ov, dict):
                actual_class = _ov.get('class', class_name)
        elif binding.kind == 'heap' and binding.addr in self.memory.heap:
            _ov = self.memory.heap[binding.addr].get('fields', {})
        resolved_class, method_cursor = self._resolve_virtual_method(class_name, actual_class, method_name)
        if method_cursor is None:
            return _INT(0)
        return self._call_method_body(resolved_class, method_name,
                                      method_cursor, args, line,
                                      arg_cursors=arg_cursors)

    def _call_method_body(self, class_name: str, method_name: str,
                          method_cursor, args: list, line: int,
                          arg_cursors=None) -> dict:
        fname = f'{class_name}::{method_name}'
        self._emit(line, f"Calling {fname}().",
                   {'type': 'call', 'function': fname})
        self.memory.push_frame(fname, line)

        params = self._get_params(method_cursor)
        caller_fi = len(self.memory.stack) - 2
        ref_wb = self._setup_ref_writeback(params, arg_cursors, caller_fi)

        for param, arg_val in zip(params, args):
            if param.spelling:
                self.memory.declare_var(param.spelling, arg_val)

        ret_val = None
        try:
            self._exec_compound(self._body_of(method_cursor))
        except ReturnException as r:
            ret_val = r.value

        self._apply_ref_writeback(ref_wb)
        self.memory.pop_frame()
        self._emit(line, f"Returning from {fname}().",
                   {'type': 'return', 'function': fname,
                    'value': self._fmt(ret_val) if ret_val is not None else 'void'})
        return ret_val if ret_val is not None else _INT(0)

    # ── Class initialisation ─────────────────────────────────────────────────

    def _init_class_on_stack(self, class_name: str, children: list, line: int) -> dict:
        cd     = self.class_defs[class_name]
        fields = {}
        for base in cd.get('bases', []):
            if base in self.class_defs:
                fields.update({f: self._default_for_type(t)
                                for f, t in self.class_defs[base]['fields'].items()})
        fields.update({f: self._default_for_type(t) for f, t in cd['fields'].items()})
        obj    = {'kind': 'struct', 'fields': fields, 'class': class_name}

        def _find_user_call(cursor, depth=0):
            """Recursively find a CALL_EXPR for a user-defined function."""
            if cursor is None or depth > 5:
                return None
            if cursor.kind == CK.CALL_EXPR and cursor.spelling in self.func_defs:
                return cursor
            for child in self._ch(cursor):
                found = _find_user_call(child, depth + 1)
                if found:
                    return found
            return None

        # ── Aggregate initialization: Student s = {"Alice", 90, d} ──────────
        # Also handles designated initializers: Student s = {.name="Sid", .marks=40}
        for c in children:
            if c.kind == CK.INIT_LIST_EXPR:
                il_ch = self._ch(c)
                field_names = list(cd['fields'].keys())
                # Check if these are designated initializers (UNEXPOSED_EXPR with MEMBER_REF child)
                if il_ch and il_ch[0].kind == CK.UNEXPOSED_EXPR:
                    sub_ch = self._ch(il_ch[0])
                    if sub_ch and sub_ch[0].kind == CK.MEMBER_REF:
                        # Designated initializers: {.field=val, ...}
                        for entry in il_ch:
                            entry_ch = self._ch(entry)
                            if entry_ch and entry_ch[0].kind == CK.MEMBER_REF:
                                fname = entry_ch[0].spelling
                                fval = self._eval(entry_ch[1]) if len(entry_ch) > 1 else _INT(0)
                                if fname in obj['fields']:
                                    obj['fields'][fname] = fval
                        return obj
                # Plain aggregate: {val1, val2, ...}
                for fi, val_c in enumerate(il_ch):
                    if fi >= len(field_names):
                        break
                    fname = field_names[fi]
                    fval = self._eval(val_c)
                    obj['fields'][fname] = fval
                return obj

        # Find constructor args — VAR_DECL children: TYPE_REF + CALL_EXPR(ctor name, args...)
        ctor_args = []
        for c in children:
            uw = self._unwrap(c)
            actual = uw if uw else c
            # CALL_EXPR spelling is the class name when it's a constructor call
            if actual.kind == CK.CALL_EXPR and actual.spelling == class_name:
                ctor_args = [self._eval(a) for a in self._ch(actual)
                             if a.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF)]
                break
            # Any CALL_EXPR (e.g. operator+, factory function) that produces a struct → use directly
            if actual.kind == CK.CALL_EXPR and actual.spelling != class_name:
                result = self._eval(actual)
                if isinstance(result, dict) and result.get('kind') == 'struct':
                    return result
            # User function returning a class value (e.g. Matrix R = mat_mul(...))
            # May be wrapped in CXX_CONSTRUCT_EXPR for copy ctor — search recursively
            user_call = _find_user_call(c)
            if user_call is not None:
                result = self._eval(user_call)
                if isinstance(result, dict) and result.get('kind') == 'struct':
                    return result
            # Also try: direct args from any CALL_EXPR (for simple cases)
            if actual.kind == CK.CALL_EXPR and actual.spelling not in self.func_defs:
                # Could be the ctor call; collect its non-ref children as args
                ctor_args = [self._eval(a) for a in self._ch(actual)
                             if a.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF,
                                               CK.MEMBER_REF_EXPR, CK.DECL_REF_EXPR)]

        # Implicit copy: T x = other_T where T has no user-defined constructors
        if (not cd['ctors'] and len(ctor_args) == 1
                and isinstance(ctor_args[0], dict)
                and ctor_args[0].get('kind') == 'struct'):
            return copy.deepcopy(ctor_args[0])

        if cd['ctors']:
            # Pick the right constructor: copy ctor if arg is same-class struct
            _ctor = cd['ctors'][0]
            if (len(ctor_args) == 1 and isinstance(ctor_args[0], dict)
                    and ctor_args[0].get('kind') == 'struct'
                    and ctor_args[0].get('class') == class_name):
                _cc = self._find_copy_ctor(class_name)
                if _cc:
                    _ctor = _cc
            obj = self._run_ctor_on_stack_val(class_name, obj, _ctor, ctor_args, line)
        return obj

    def _find_copy_ctor(self, class_name: str):
        """Return the copy constructor cursor if present, else None."""
        cd = self.class_defs.get(class_name, {})
        for ctor in cd.get('ctors', []):
            params = self._get_params(ctor)
            if len(params) == 1:
                pt = params[0].type.spelling if params[0].type else ''
                if '&' in pt and class_name in pt:
                    return ctor
        return None

    def _build_class_value(self, class_name: str, args: list, line: int) -> dict:
        cd     = self.class_defs[class_name]
        fields = {}
        # Include inherited fields from base classes
        for base in cd.get('bases', []):
            if base in self.class_defs:
                fields.update({f: self._default_for_type(t)
                                for f, t in self.class_defs[base]['fields'].items()})
        fields.update({f: self._default_for_type(t) for f, t in cd['fields'].items()})
        obj    = {'kind': 'struct', 'fields': fields, 'class': class_name}
        if cd['ctors']:
            obj = self._run_ctor_on_stack_val(class_name, obj, cd['ctors'][0], args, line)
        return obj

    def _run_ctor_on_stack_val(self, class_name: str, obj: dict,
                               ctor_cursor, args: list, line: int) -> dict:
        ctor_ch  = self._ch(ctor_cursor)
        body_idx = next((i for i, c in enumerate(ctor_ch)
                         if c.kind == CK.COMPOUND_STMT), None)
        init_ch  = ctor_ch[:body_idx] if body_idx is not None else []
        body_c   = ctor_ch[body_idx]  if body_idx is not None else None

        params   = self._get_params(ctor_cursor)

        # Initialiser list: pairs of MEMBER_REF + value_cursor
        # Filter PARM_DECL — libclang puts ctor params at index 0 before the init pairs
        _skip_kinds = (CK.PARM_DECL, CK.TEMPLATE_TYPE_PARAMETER, CK.TEMPLATE_REF,
                       CK.NAMESPACE_REF, CK.TYPE_REF)
        _raw = [c for c in init_ch if c.kind not in _skip_kinds]
        # Re-insert TYPE_REF items that immediately precede a CALL_EXPR (base class init)
        init_items = []
        _ric = [c for c in init_ch if c.kind not in (
            CK.PARM_DECL, CK.TEMPLATE_TYPE_PARAMETER, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
        _i2 = 0
        while _i2 < len(_ric):
            c = _ric[_i2]
            if (c.kind == CK.TYPE_REF and _i2 + 1 < len(_ric)
                    and _ric[_i2 + 1].kind == CK.CALL_EXPR):
                init_items.append(c)      # keep base-class TYPE_REF + CALL_EXPR
                init_items.append(_ric[_i2 + 1])
                _i2 += 2
            elif c.kind == CK.TYPE_REF:
                _i2 += 1                  # skip lone TYPE_REF (template type)
            else:
                init_items.append(c)
                _i2 += 1
        i = 0
        while i + 1 < len(init_items):
            field_c = init_items[i]
            val_c   = init_items[i + 1]
            if field_c.kind == CK.MEMBER_REF:
                field_name = field_c.spelling
                val_expr   = self._unwrap(val_c) or val_c
                # Push a temp frame so we can evaluate the initialiser
                pmap = {p.spelling: a for p, a in zip(params, args) if p.spelling}
                self.memory.stack.append({'function': '__init', 'line': line, 'variables': pmap})
                val = self._eval(val_expr)
                self.memory.stack.pop()
                obj['fields'][field_name] = val
            elif field_c.kind == CK.TYPE_REF and val_c.kind == CK.CALL_EXPR:
                # Base class constructor call: Animal(n)
                base_cls = field_c.spelling.replace('class ', '').replace('struct ', '').strip()
                if base_cls in self.class_defs:
                    pmap = {p.spelling: a for p, a in zip(params, args) if p.spelling}
                    self.memory.stack.append({'function': '__init', 'line': line, 'variables': pmap})
                    base_args = [self._eval(a) for a in self._ch(val_c)
                                 if a.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF)]
                    self.memory.stack.pop()
                    base_cd = self.class_defs[base_cls]
                    base_fields = {f: self._default_for_type(t) for f, t in base_cd['fields'].items()}
                    base_obj = {'kind': 'struct', 'fields': base_fields, 'class': base_cls}
                    if base_cd['ctors']:
                        base_obj = self._run_ctor_on_stack_val(base_cls, base_obj, base_cd['ctors'][0], base_args, line)
                    obj['fields'].update(base_obj['fields'])
            i += 2


        # Constructor body
        if body_c:
            temp_name = f'__ctmp_{id(obj)}'
            if self.memory.stack:
                frame_idx = len(self.memory.stack) - 1
                self.memory.stack[frame_idx]['variables'][temp_name] = obj
                binding = _ThisBinding('stack', frame_idx=frame_idx, var_name=temp_name,
                                       class_name=class_name)
                self._this_stack.append(binding)
                self.memory.push_frame(f'{class_name}::ctor', line)
                for p, a in zip(params, args):
                    if p.spelling:
                        self.memory.declare_var(p.spelling, a)
                try:
                    self._exec_compound(body_c)
                except ReturnException:
                    pass
                self.memory.pop_frame()
                self._this_stack.pop()
                obj = self.memory.stack[frame_idx]['variables'].pop(temp_name, obj)
        return obj

    def _run_ctor_on_heap(self, class_name: str, addr: str,
                          ctor_cursor, args: list, line: int):
        ctor_ch  = self._ch(ctor_cursor)
        body_idx = next((i for i, c in enumerate(ctor_ch)
                         if c.kind == CK.COMPOUND_STMT), None)
        init_ch  = ctor_ch[:body_idx] if body_idx is not None else []
        body_c   = ctor_ch[body_idx]  if body_idx is not None else None
        params   = self._get_params(ctor_cursor)

        # Initialiser list — filter PARM_DECL before iterating pairs
        _skip_kinds = (CK.PARM_DECL, CK.TEMPLATE_TYPE_PARAMETER, CK.TEMPLATE_REF,
                       CK.NAMESPACE_REF, CK.TYPE_REF)
        _raw = [c for c in init_ch if c.kind not in _skip_kinds]
        # Re-insert TYPE_REF items that immediately precede a CALL_EXPR (base class init)
        init_items = []
        _ric = [c for c in init_ch if c.kind not in (
            CK.PARM_DECL, CK.TEMPLATE_TYPE_PARAMETER, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
        _i2 = 0
        while _i2 < len(_ric):
            c = _ric[_i2]
            if (c.kind == CK.TYPE_REF and _i2 + 1 < len(_ric)
                    and _ric[_i2 + 1].kind == CK.CALL_EXPR):
                init_items.append(c)      # keep base-class TYPE_REF + CALL_EXPR
                init_items.append(_ric[_i2 + 1])
                _i2 += 2
            elif c.kind == CK.TYPE_REF:
                _i2 += 1                  # skip lone TYPE_REF (template type)
            else:
                init_items.append(c)
                _i2 += 1
        i = 0
        while i + 1 < len(init_items):
            field_c = init_items[i]
            val_c   = init_items[i + 1]
            if field_c.kind == CK.MEMBER_REF:
                pmap = {p.spelling: a for p, a in zip(params, args) if p.spelling}
                self.memory.stack.append({'function': '__init', 'line': line, 'variables': pmap})
                val = self._eval(self._unwrap(val_c) or val_c)
                self.memory.stack.pop()
                self.memory.write_field(addr, field_c.spelling, val, line)
            i += 2

        # Constructor body
        if body_c:
            binding = _ThisBinding('heap', addr=addr, class_name=class_name)
            self._this_stack.append(binding)
            self.memory.push_frame(f'{class_name}::ctor', line)
            for p, a in zip(params, args):
                if p.spelling:
                    self.memory.declare_var(p.spelling, a)
            try:
                self._exec_compound(body_c)
            except ReturnException:
                pass
            self.memory.pop_frame()
            self._this_stack.pop()

    # ── vector support ───────────────────────────────────────────────────────

    def _init_vector(self, type_spell: str, children: list, line: int) -> dict:
        is_2d = type_spell.count('vector') > 1

        # Filter out TYPE_REF / TEMPLATE_REF, then unwrap remaining children
        real_args = []
        for c in children:
            if c.kind in (CK.TYPE_REF, CK.TEMPLATE_REF):
                continue
            uw = self._unwrap(c)
            real_args.append(uw if uw else c)

        # ── Copy constructor: vector(another_vector) → deep copy ──
        # libclang wraps `return dist` (where dist is vector<T>) in a copy constructor
        # CALL_EXPR 'vector' with the original vector as the sole argument.
        if not is_2d and len(real_args) == 1:
            arg_val = self._eval(real_args[0])
            if isinstance(arg_val, dict) and arg_val.get('kind') == 'array':
                result = copy.deepcopy(arg_val)
                # vector<pair<T,U>> from {{k,v},...}: inner lists → pair structs
                if 'pair' in type_spell and result.get('rows'):
                    result['values'] = [
                        self._make_pair(
                            _INT(int(row[0])) if isinstance(row[0], (int, float)) else row[0],
                            _INT(int(row[1])) if isinstance(row[1], (int, float)) else row[1],
                        ) if isinstance(row, list) and len(row) >= 2 else row
                        for row in result.get('values', [])
                    ]
                    del result['rows']
                    result.pop('cols', None)
                return result

        if is_2d:
            # Init from {{row},{row},...} — already parsed as 2D array by _eval_init_list
            if real_args:
                first_val = self._eval(real_args[0])
                if isinstance(first_val, dict) and first_val.get('kind') == 'array' and first_val.get('rows'):
                    return copy.deepcopy(first_val)
            n = self._to_int(self._eval(real_args[0])) if real_args else 0
            if len(real_args) <= 1:
                # vector<vector<T>>(n) — n empty inner arrays (adjacency list style)
                return {'kind': 'array',
                        'values': [{'kind': 'array', 'values': []} for _ in range(n)]}
            # vector<vector<T>>(n, vector<T>(m, init)) — NxM matrix
            inner = real_args[1]
            # Recursively unwrap UNEXPOSED_EXPR / CXX_FUNCTIONAL_CAST_EXPR layers
            inner_vec = inner
            while inner_vec is not None and inner_vec.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR):
                ch_inner = self._ch(inner_vec)
                inner_vec = ch_inner[0] if ch_inner else None
            # CXX_FUNCTIONAL_CAST_EXPR wraps functional-style ctor: vector<int>(m+1)
            # Its children are [TEMPLATE_REF, CALL_EXPR] — pick the CALL_EXPR
            if inner_vec is not None and inner_vec.kind == CK.CXX_FUNCTIONAL_CAST_EXPR:
                call_ch = [c for c in self._ch(inner_vec) if c.kind == CK.CALL_EXPR]
                if call_ch:
                    inner_vec = call_ch[0]
            m, init_val = n, 0
            if inner_vec is not None and inner_vec.kind == CK.CALL_EXPR and 'vector' in inner_vec.spelling:
                ich = [c for c in self._ch(inner_vec)
                       if c.kind not in (CK.TYPE_REF, CK.TEMPLATE_REF, CK.NAMESPACE_REF)]
                if ich:
                    m = self._to_int(self._eval(ich[0]))
                if len(ich) > 1:
                    init_val = self._to_int(self._eval(ich[1]))
            else:
                m = self._to_int(self._eval(inner))
            if m == 0:
                m = n
            return {'kind': 'array',
                    'values': [[init_val] * m for _ in range(n)],
                    'rows': n, 'cols': m}
        else:
            n        = self._to_int(self._eval(real_args[0])) if real_args else 0
            init_val = self._to_int(self._eval(real_args[1])) if len(real_args) > 1 else 0
            return {'kind': 'array', 'values': [init_val] * n}

    def _extract_map_init_pairs(self, cursor) -> list:
        """Recursively find INIT_LIST_EXPR in map initializer and return [(key, val)] pairs.
        The structure is: UNEXPOSED_EXPR → CALL_EXPR 'map' → UNEXPOSED_EXPR... → INIT_LIST_EXPR
        where each child of the inner INIT_LIST_EXPR is an INIT_LIST_EXPR [k, v].
        """
        # Unwrap transparent layers
        c = cursor
        while c is not None and c.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR,
                                            CK.CXX_FUNCTIONAL_CAST_EXPR):
            ch = self._ch(c)
            if not ch:
                break
            # If this is a CALL_EXPR 'map', recurse into its children
            if c.kind == CK.UNEXPOSED_EXPR:
                call_ch = [x for x in ch if x.kind == CK.CALL_EXPR]
                if call_ch:
                    c = call_ch[0]
                    continue
            c = ch[0]
        # If CALL_EXPR, look for INIT_LIST_EXPR in children
        if c is not None and c.kind == CK.CALL_EXPR:
            for child in self._ch(c):
                result = self._extract_map_init_pairs(child)
                if result is not None:
                    return result
        # If INIT_LIST_EXPR where all children are INIT_LIST_EXPR → parse as pairs
        if c is not None and c.kind == CK.INIT_LIST_EXPR:
            ch = self._ch(c)
            if ch and all(x.kind == CK.INIT_LIST_EXPR for x in ch):
                pairs = []
                for pair_c in ch:
                    elems = [self._eval(e) for e in self._ch(pair_c)]
                    if len(elems) >= 2:
                        pairs.append((elems[0], elems[1]))
                return pairs
            # Single-level INIT_LIST_EXPR — recurse into children
            for child in ch:
                result = self._extract_map_init_pairs(child)
                if result is not None:
                    return result
        return []

    def _extract_set_init_values(self, cursor) -> list:
        """Recursively find INIT_LIST_EXPR in set/unordered_set initializer and return a flat list of values."""
        c = cursor
        while c is not None and c.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR,
                                            CK.CXX_FUNCTIONAL_CAST_EXPR):
            ch = self._ch(c)
            if not ch:
                break
            if c.kind == CK.UNEXPOSED_EXPR:
                call_ch = [x for x in ch if x.kind == CK.CALL_EXPR]
                if call_ch:
                    c = call_ch[0]
                    continue
            c = ch[0]
        if c is not None and c.kind == CK.CALL_EXPR:
            for child in self._ch(c):
                result = self._extract_set_init_values(child)
                if result:
                    return result
        if c is not None and c.kind == CK.INIT_LIST_EXPR:
            ch = self._ch(c)
            # Flat value list (children are not inner INIT_LIST_EXPRs)
            if ch and not all(x.kind == CK.INIT_LIST_EXPR for x in ch):
                return [self._eval(e) for e in ch]
            for child in ch:
                result = self._extract_set_init_values(child)
                if result:
                    return result
        return []

    def _call_vector_method(self, obj_name: str, obj_c,
                            method_name: str, args: list, line: int) -> dict:
        # Resolve array value (local var or this-field).
        # _cursor_name returns 'this.field' for implicit this-member access;
        # strip that prefix so we look up the correct field name.
        real_name = obj_name[5:] if obj_name.startswith('this.') else obj_name

        arr     = None
        is_this = False
        if real_name:
            for frame in reversed(self.memory.stack):
                if real_name in frame['variables']:
                    arr = frame['variables'][real_name]
                    break
        if arr is None and self._this_stack:
            arr     = self._read_this_field(real_name, line)
            is_this = True

        if not isinstance(arr, dict) or arr.get('kind') != 'array':
            arr = {'kind': 'array', 'values': []}

        vals = arr.get('values', [])

        def save():
            if is_this:
                self._write_this_field(real_name, arr, line)
            elif real_name:
                self.memory.set_var(real_name, arr)

        if method_name == 'push_back':
            raw    = args[0] if args else _INT(0)
            stored = self._arr_push(arr, raw)
            save()
            self.memory.update_line(line)
            self._emit(line, f"{obj_name}.push_back({self._fmt(stored)}).",
                       {'type': 'assign', 'target': obj_name, 'value': self._fmt(stored)})
            return _INT(0)

        if method_name == 'size':
            return _INT(len(vals))
        if method_name == 'empty':
            return _INT(int(len(vals) == 0))

        if method_name == 'resize':
            n    = self._to_int(args[0]) if args else len(vals)
            if len(args) > 1:
                raw_fill = args[1]
                # Use plain int for scalar fills so array stays number[]
                fill = (copy.deepcopy(raw_fill)
                        if isinstance(raw_fill, dict) and raw_fill.get('kind') in ('struct', 'array')
                        else self._to_int(raw_fill))
            else:
                obj_type_spell = (obj_c.type.spelling if obj_c and obj_c.type else '')
                fill = ({'kind': 'array', 'values': []}
                        if obj_type_spell.count('vector') >= 2
                        else 0)
            while len(vals) < n: vals.append(copy.deepcopy(fill))
            arr['values'] = vals[:n]
            save()
            shape = f'[{n}]'
            self._emit(line, f'{real_name}.resize({n}).',
                       {'type': 'assign', 'target': real_name, 'value': shape})
            return _INT(0)

        if method_name == 'back':
            if not vals:
                self._crash(line, 'out_of_range', f'{real_name}.back() called on empty container')
            v = vals[-1]
            return v if isinstance(v, dict) else _INT(int(v))
        if method_name == 'front':
            if not vals:
                self._crash(line, 'out_of_range', f'{real_name}.front() called on empty container')
            v = vals[0]
            return v if isinstance(v, dict) else _INT(int(v))

        if method_name == 'clear':
            arr['values'] = []
            save()
            return _INT(0)

        if method_name == 'pop_back':
            if not vals:
                self._crash(line, 'out_of_range', f'{real_name}.pop_back() called on empty vector')
            vals.pop()
            arr['values'] = vals
            save()
            return _INT(0)

        if method_name == 'begin':
            return {'kind': 'iterator', 'data': vals, 'idx': 0} if vals else {'kind': 'iterator', 'data': vals, 'idx': None}
        if method_name == 'end':
            return {'kind': 'iterator', 'data': vals, 'idx': None}
        if method_name == 'rbegin':
            return {'kind': 'iterator', 'data': vals, 'idx': len(vals) - 1} if vals else {'kind': 'iterator', 'data': vals, 'idx': None}
        if method_name == 'rend':
            return {'kind': 'iterator', 'data': vals, 'idx': None}

        return _INT(0)

    def _call_method_on_subscript(self, subscript_c, method_name: str,
                                   args: list, line: int) -> dict:
        """Handle adj[u].push_back(v) — method called on a subscripted element."""
        sub_ch  = self._ch(subscript_c)
        outer_c = sub_ch[0] if sub_ch else None
        idx_c   = sub_ch[-1] if len(sub_ch) > 1 else None
        if outer_c is None or idx_c is None:
            return _INT(0)

        idx = self._to_int(self._eval(self._unwrap(idx_c) or idx_c))

        outer_name = self._cursor_name(outer_c)
        real_name  = outer_name[5:] if outer_name.startswith('this.') else outer_name

        outer_arr = None
        is_this   = False
        for frame in reversed(self.memory.stack):
            if real_name in frame['variables']:
                outer_arr = frame['variables'][real_name]
                break
        if outer_arr is None and self._this_stack:
            outer_arr = self._read_this_field(real_name, line)
            is_this   = True

        if not isinstance(outer_arr, dict) or outer_arr.get('kind') != 'array':
            return _INT(0)

        vals = outer_arr.get('values', [])
        if not (0 <= idx < len(vals)):
            return _INT(0)

        inner = vals[idx]
        if isinstance(inner, list):
            inner = {'kind': 'array', 'values': inner}
        elif not isinstance(inner, dict):
            inner = {'kind': 'array', 'values': []}
        inner_vals = list(inner.get('values', []))

        if method_name == 'push_back':
            raw    = args[0] if args else _INT(0)
            stored = self._arr_push(inner, raw)
            vals[idx] = inner
            outer_arr['values'] = vals
            if is_this:
                self._write_this_field(real_name, outer_arr, line)
            elif real_name:
                self.memory.set_var(real_name, outer_arr)
            self.memory.update_line(line)
            self._emit(line, f"{real_name}[{idx}].push_back({self._fmt(stored)}).",
                       {'type': 'assign', 'target': f'{real_name}[{idx}]', 'value': self._fmt(stored)})
            return _INT(0)

        if method_name == 'size':
            return _INT(len(inner_vals))
        if method_name == 'empty':
            return _INT(int(len(inner_vals) == 0))
        if method_name == 'back':
            v = inner_vals[-1] if inner_vals else _INT(0)
            return v if isinstance(v, dict) else _INT(int(v))
        if method_name == 'front':
            v = inner_vals[0] if inner_vals else _INT(0)
            return v if isinstance(v, dict) else _INT(int(v))
        return _INT(0)

    def _call_method_on_c_array_subscript(self, subscript_c, method_name: str, args: list, line: int):
        """Handle arr[i].method() where arr is a raw C fixed-size array of vectors.
        subscript_c is an ARRAY_SUBSCRIPT_EXPR node."""
        sub_ch = self._ch(subscript_c)
        if len(sub_ch) < 2:
            return _INT(0)
        arr_c, idx_c = sub_ch[0], sub_ch[1]
        idx = self._to_int(self._eval(self._unwrap(idx_c) or idx_c))
        arr_name, outer_arr = self._resolve_array(arr_c, line)
        if not isinstance(outer_arr, dict) or outer_arr.get('kind') != 'array':
            return _INT(0)
        vals = outer_arr.get('values', [])
        declared = outer_arr.get('declared_size')
        # Lazily extend the outer array if idx is within declared bounds but beyond cap
        if not (0 <= idx < len(vals)):
            declared_bound = declared if declared is not None else len(vals)
            if 0 <= idx < declared_bound:
                while len(vals) <= idx:
                    vals.append({'kind': 'array', 'values': []})
                outer_arr['values'] = vals
            else:
                return _INT(0)
        inner = vals[idx]
        if isinstance(inner, list):
            inner = {'kind': 'array', 'values': inner}
        elif not isinstance(inner, dict):
            inner = {'kind': 'array', 'values': []}
        inner_vals = list(inner.get('values', []))
        real_name = (arr_name.split(':')[-1] if arr_name and arr_name.startswith('__')
                     else arr_name) or 'arr'
        if method_name == 'push_back':
            raw    = args[0] if args else _INT(0)
            stored = self._arr_push(inner, raw)
            vals[idx] = inner
            outer_arr['values'] = vals
            self._put_array(arr_name, arr_c, outer_arr, line)
            self.memory.update_line(line)
            self._emit(line, f"{real_name}[{idx}].push_back({self._fmt(stored)}).",
                       {'type': 'assign', 'target': f'{real_name}[{idx}]', 'value': self._fmt(stored)})
            return _INT(0)
        if method_name == 'clear':
            inner['values'] = []
            vals[idx] = inner
            outer_arr['values'] = vals
            self._put_array(arr_name, arr_c, outer_arr, line)
            return _INT(0)
        if method_name in ('size', 'length'):
            return _INT(len(inner_vals))
        if method_name == 'empty':
            return _INT(int(len(inner_vals) == 0))
        if method_name == 'back':
            v = inner_vals[-1] if inner_vals else _INT(0)
            return v if isinstance(v, dict) else _INT(int(v))
        if method_name == 'front':
            v = inner_vals[0] if inner_vals else _INT(0)
            return v if isinstance(v, dict) else _INT(int(v))
        if method_name == 'pop_back':
            if inner_vals:
                inner['values'] = inner_vals[:-1]
                vals[idx] = inner
                outer_arr['values'] = vals
                self._put_array(arr_name, arr_c, outer_arr, line)
            return _INT(0)
        return _INT(0)

    # ── Structured bindings (C++17) ──────────────────────────────────────────

    def _bind_structured(self, binding_vars: list, val, line: int):
        """Declare each name in binding_vars from corresponding field/element of val."""
        if isinstance(val, dict) and val.get('kind') == 'struct':
            field_vals = list(val.get('fields', {}).values())
        elif isinstance(val, dict) and val.get('kind') == 'array':
            field_vals = val.get('values', [])
        else:
            field_vals = [val]
        for i, name in enumerate(binding_vars):
            v = field_vals[i] if i < len(field_vals) else _INT(0)
            self.memory.declare_var(name, v)

    def _exec_structured_binding(self, cursor):
        """Handle: auto [a, b] = expr;  (UNEXPOSED_DECL '[a, b]')
        Children: UNEXPOSED_DECL 'a', UNEXPOSED_DECL 'b', ..., init_expr (CALL_EXPR/etc.)
        """
        ch = self._ch(cursor)
        binding_vars = [c.spelling for c in ch if c.kind == CK.UNEXPOSED_DECL and c.spelling]
        init_c = next((c for c in ch if c.kind != CK.UNEXPOSED_DECL), None)
        if not init_c or not binding_vars:
            return
        val = self._eval(init_c)
        line = self._adj(cursor.location.line)
        self._bind_structured(binding_vars, val, line)

    # ── Range-based for loop ─────────────────────────────────────────────────

    def _exec_range_for(self, cursor):
        """for (T x : range) { body }
        libclang children: [VAR_DECL/UNEXPOSED_DECL loop_var, range_expr, COMPOUND_STMT body]
        """
        ch = self._ch(cursor)
        if len(ch) < 3:
            return
        loop_var_c = ch[0]
        range_c    = ch[1]
        body_c     = ch[2]

        line = self._adj(cursor.location.line)

        # Detect C++17 structured binding loop var: UNEXPOSED_DECL '[a, b]'
        if loop_var_c.kind == CK.UNEXPOSED_DECL:
            sub = self._ch(loop_var_c)
            binding_vars = [c.spelling for c in sub if c.kind == CK.UNEXPOSED_DECL and c.spelling]
            loop_var_name = None
        else:
            loop_var_name = loop_var_c.spelling
            binding_vars  = None

        # Evaluate the range expression once
        range_val = self._eval(range_c)
        if isinstance(range_val, dict) and range_val.get('kind') == 'array':
            elements = range_val.get('values', [])
        elif isinstance(range_val, dict) and range_val.get('kind') == 'char':
            # String iteration — yield each character
            elements = [{'kind': 'char', 'value': c} for c in range_val.get('value', '')]
        elif isinstance(range_val, dict) and range_val.get('kind') == 'map':
            # Map iteration — yield pair<key,value> in sorted key order
            data = range_val.get('data', {})
            def _map_sort_key(k):
                return (int(k) if isinstance(k, str) and k.lstrip('-').isdigit() else (0, k))
            elements = [
                self._make_pair(
                    _INT(int(k)) if isinstance(k, str) and k.lstrip('-').isdigit()
                                 else {'kind': 'char', 'value': k},
                    v
                )
                for k, v in sorted(data.items(), key=lambda x: _map_sort_key(x[0]))
            ]
        elif isinstance(range_val, dict) and range_val.get('kind') in ('set', 'multiset'):
            # Set/multiset iteration — data is already sorted, yield each .val
            data = range_val.get('data', [])
            elements = [
                e['val'] if isinstance(e, dict) and 'val' in e
                else (_INT(int(e)) if isinstance(e, str) and e.lstrip('-').isdigit()
                      else {'kind': 'char', 'value': str(e)})
                for e in data
            ]
        else:
            return

        # Detect reference binding (auto& x : v) — enables write-back
        is_ref = ('&' in (loop_var_c.type.spelling if loop_var_c and loop_var_c.type else ''))
        range_name = self._cursor_name(range_c) if is_ref and not binding_vars else None

        # Track initial container size for modify-during-iteration check (#15)
        range_container_name = self._cursor_name(range_c) if range_c else None
        initial_container_size = len(elements)

        # ── Iterator invalidation visualization (#14) ──────────────────────────
        # Allocate a fake heap block for the vector's internal buffer so that
        # when push_back reallocates, we can free the old block and show the
        # iterator pointer as dangling (red arrow in the UI).
        iter_var_name = None
        if range_container_name and not binding_vars:
            buf_addr = self._vec_alloc_buf(range_container_name, initial_container_size, line)
            iter_var_name = f"__{range_container_name}_iter"
            iter_ptr = {'kind': 'pointer', 'address': buf_addr}
            self.memory.declare_var(iter_var_name, iter_ptr)
            self._iter_sources[range_container_name] = iter_var_name
            self._vec_iter_vars[range_container_name] = iter_var_name

        iters = 0
        for i, elem in enumerate(elements):
            if iters >= MAX_ITERS:
                break
            iters += 1
            if isinstance(elem, dict):
                val = elem
            elif isinstance(elem, list):
                # Plain list → treat as array (e.g. vector<vector<int>> element)
                val = {'kind': 'array', 'values': elem}
            else:
                val = _INT(int(elem) if elem is not None else 0)
            if binding_vars:
                self._bind_structured(binding_vars, val, line)
            else:
                self.memory.declare_var(loop_var_name, val)
                self.memory.update_line(line)
                self._emit(line, f"{loop_var_name} = {self._fmt(val)}",
                           {'type': 'assign', 'target': loop_var_name, 'value': self._fmt(val)})
            try:
                self._exec_stmt(body_c)
            except BreakException:
                break
            except ContinueException:
                pass
            # Modifying container during iteration check (#15)
            if range_container_name:
                try:
                    cur_val = self.memory.get_var(range_container_name)
                    if isinstance(cur_val, dict) and cur_val.get('kind') == 'array':
                        cur_size = len(cur_val.get('values', []))
                        if cur_size != initial_container_size:
                            # Free old buffer, alloc new — shows dangling iter in heap
                            self._vec_free_buf(range_container_name, line)
                            new_addr = self._vec_alloc_buf(range_container_name, cur_size, line)
                            # Update the synthetic iter pointer to still point to OLD (freed) addr
                            if iter_var_name:
                                old_addr = None
                                for blk_addr, blk in self.memory.heap.items():
                                    if (blk.get('typeName', '').startswith(f'{range_container_name}[ ]')
                                            and blk.get('state') == 'freed'):
                                        old_addr = blk_addr
                                if old_addr:
                                    self.memory.set_var(iter_var_name,
                                                        {'kind': 'pointer', 'address': old_addr})
                            self._warn(line, 'modify-during-iter',
                                       f"Container '{range_container_name}' changed size from "
                                       f"{initial_container_size} to {cur_size} during range-for iteration. "
                                       f"Vector reallocated — all iterators are now dangling (#14/#15).")
                            initial_container_size = cur_size
                except RuntimeError:
                    pass
            # Write-back for auto& (reference binding)
            if is_ref and loop_var_name and range_name:
                try:
                    updated = self.memory.get_var(loop_var_name)
                    range_arr = self.memory.get_var(range_name)
                    if isinstance(range_arr, dict) and range_arr.get('kind') == 'array':
                        rvals = range_arr.get('values', [])
                        if 0 <= i < len(rvals):
                            rvals[i] = (updated if isinstance(updated, dict)
                                        and updated.get('kind') in ('struct', 'array')
                                        else self._to_int(updated))
                            range_arr['values'] = rvals
                            self.memory.set_var(range_name, range_arr)
                except RuntimeError:
                    pass

        # Clean up synthetic iter pointer after loop ends
        if iter_var_name and range_container_name:
            self._iter_sources.pop(range_container_name, None)
            self._vec_iter_vars.pop(range_container_name, None)
            # Remove iter var from current frame so it doesn't persist
            for frame in reversed(self.memory.stack):
                if iter_var_name in frame['variables']:
                    del frame['variables'][iter_var_name]
                    break

    # ── Queue / stack / deque method dispatch ────────────────────────────────

    def _call_collection_method(self, obj_name: str, method_name: str,
                                 args: list, line: int) -> dict:
        """Handle push/pop/front/back/top/empty/size on queue, stack, deque."""
        real_name = obj_name[5:] if obj_name.startswith('this.') else obj_name

        col = None
        is_this = False
        for frame in reversed(self.memory.stack):
            if real_name in frame['variables']:
                col = frame['variables'][real_name]
                break
        if col is None and self._this_stack:
            col = self._read_this_field(real_name, line)
            is_this = True

        if not isinstance(col, dict) or 'ctype' not in col:
            col = {'kind': 'array', 'values': [], 'ctype': ''}

        vals = col.get('values', [])

        def save():
            if is_this:
                self._write_this_field(real_name, col, line)
            elif real_name:
                self.memory.set_var(real_name, col)

        def _pair_key(v):
            """Sort key for pair/struct values: use first field, then second."""
            if isinstance(v, dict) and v.get('kind') == 'struct':
                f = v.get('fields', {})
                fst = f.get('first', _INT(0))
                snd = f.get('second', _INT(0))
                return (self._to_int(fst), self._to_int(snd))
            return (self._to_int(v), 0)

        if method_name == 'push':
            val = args[0] if args else _INT(0)
            vals.append(val)
            if col.get('ctype') == 'priority_queue':
                is_min = col.get('min_heap', False)
                vals.sort(key=_pair_key, reverse=not is_min)
            col['values'] = vals
            save()
            self.memory.update_line(line)
            self._emit(line, f"{real_name}.push({self._fmt(val)}).",
                       {'type': 'assign', 'target': real_name, 'value': self._fmt(val)})
            # Queue duplicate detection (#7/#21 Wrong BFS Visited Timing / Missing Visited Array)
            ctype_str = col.get('ctype', '')
            if 'queue' in ctype_str and 'priority_queue' not in ctype_str:
                pushed_int = self._to_int(val)
                if real_name not in self._queue_push_log:
                    self._queue_push_log[real_name] = {}
                log = self._queue_push_log[real_name]
                log[pushed_int] = log.get(pushed_int, 0) + 1
                if log[pushed_int] == 3:
                    self._warn(line, 'queue-duplicate',
                               f"Value {pushed_int} pushed to '{real_name}' 3+ times. "
                               f"Likely missing visited[] array in BFS — nodes revisited (#7/#21).")
            return _INT(0)

        if method_name == 'front':
            if not vals:
                self._crash(line, 'out_of_range', f'{real_name}.front() called on empty container')
            return vals[0]

        if method_name == 'top':
            if not vals:
                self._crash(line, 'out_of_range', f'{real_name}.top() called on empty container')
            ctype = col.get('ctype', '')
            if 'stack' in ctype:
                return vals[-1]  # stack top = last pushed
            return vals[0]  # priority_queue top = first (sorted)

        if method_name == 'back':
            if not vals:
                self._crash(line, 'out_of_range', f'{real_name}.back() called on empty container')
            return vals[-1]

        if method_name == 'pop':
            ctype = col.get('ctype', '')
            popped = None
            if 'stack' in ctype:
                if not vals:
                    self._crash(line, 'out_of_range', f'{real_name}.pop() called on empty stack')
                popped = vals.pop()
            else:  # queue/priority_queue/deque: pop from front
                if not vals:
                    self._crash(line, 'out_of_range', f'{real_name}.pop() called on empty container')
                popped = vals.pop(0)
            col['values'] = vals
            save()
            self.memory.update_line(line)
            self._emit(line, f"{real_name}.pop().",
                       {'type': 'assign', 'target': real_name, 'value': self._fmt(popped or _INT(0))})
            return _INT(0)

        if method_name == 'pop_front':
            if vals: vals.pop(0)
            col['values'] = vals
            save()
            return _INT(0)

        if method_name == 'pop_back':
            if vals: vals.pop()
            col['values'] = vals
            save()
            return _INT(0)

        if method_name == 'empty':
            return _INT(int(len(vals) == 0))

        if method_name == 'size':
            return _INT(len(vals))

        # push_back / push_front for deque
        if method_name == 'push_back':
            raw    = args[0] if args else _INT(0)
            stored = self._arr_push(col, raw)
            save()
            self.memory.update_line(line)
            self._emit(line, f"{real_name}.push_back({self._fmt(stored)}).",
                       {'type': 'assign', 'target': real_name, 'value': self._fmt(stored)})
            # Iterator invalidation (#14): warn if any iterator for this vector is in scope
            if real_name in self._iter_sources:
                self._warn(line, 'iterator-invalidation',
                           f"push_back on '{real_name}' may invalidate all iterators/pointers "
                           f"to it (#14). Active iterator '{self._iter_sources[real_name]}' is now dangling.")
            return _INT(0)

        if method_name == 'push_front':
            raw    = args[0] if args else _INT(0)
            stored = (raw if isinstance(raw, dict) and raw.get('kind') in ('struct', 'array')
                      else self._to_int(raw))
            vals   = col.get('values', [])
            vals.insert(0, stored)
            col['values']    = vals
            col['lastWrite'] = [0]
            save()
            self.memory.update_line(line)
            self._emit(line, f"{real_name}.push_front({self._fmt(stored)}).",
                       {'type': 'assign', 'target': real_name, 'value': self._fmt(stored)})
            return _INT(0)

        return _INT(0)

    def _make_map_key(self, val) -> str:
        """Convert a value to a string map key."""
        if isinstance(val, dict):
            k = val.get('kind')
            if k == 'char':    return val.get('value', '')
            if k == 'int':     return str(val.get('value', 0))
            if k == 'pointer': return val.get('address') or 'NULL'
            if k == 'struct':
                # pair<T,U> → "(first,second)"
                fields = val.get('fields', {})
                f = self._make_map_key(fields.get('first',  {'kind': 'int', 'value': 0}))
                s = self._make_map_key(fields.get('second', {'kind': 'int', 'value': 0}))
                return f'({f},{s})'
            if k == 'array' and not val.get('rows'):
                # {a, b} init-list that libclang didn't type as pair<> — treat as pair key
                vals = val.get('values', [])
                if len(vals) == 2:
                    return f'({self._make_map_key(vals[0])},{self._make_map_key(vals[1])})'
        if isinstance(val, (int, float)): return str(int(val))
        return str(val)

    @staticmethod
    def _set_sort_key(key: str):
        """Sort key for set entries: pairs sort lexicographically by (first, second)."""
        if key.startswith('(') and ',' in key:
            inner = key[1:-1]
            parts = inner.split(',', 1)
            try:
                return (int(parts[0]), int(parts[1]))
            except ValueError:
                pass
        try:
            return (int(key), 0)
        except ValueError:
            return (float('inf'), 0)

    def _call_multiset_method(self, obj_name: str, method_name: str, args: list, line: int) -> dict:
        """Handle multiset<T> method calls. data is a sorted list allowing duplicates,
        stored as [{'key': str, 'val': value}, ...]."""
        real_name = obj_name[5:] if obj_name.startswith('this.') else obj_name
        col = None
        for frame in reversed(self.memory.stack):
            if real_name in frame['variables']:
                col = frame['variables'][real_name]
                break
        if not isinstance(col, dict) or col.get('kind') != 'multiset':
            col = {'kind': 'multiset', 'data': []}

        data = col.get('data', [])

        def _ekey(e): return e['key'] if isinstance(e, dict) and 'key' in e else str(e)
        def _eval_e(e): return e.get('val', _INT(0)) if isinstance(e, dict) else _INT(0)
        def _mk_iter(idx): return {'kind': 'iterator', 'data': data, 'idx': idx}
        def _end_iter():   return {'kind': 'iterator', 'data': data, 'idx': None}

        def save():
            if real_name:
                self.memory.set_var(real_name, col)

        if method_name == 'size':
            return _INT(len(data))
        if method_name == 'empty':
            return _INT(int(len(data) == 0))
        if method_name == 'count':
            key = self._make_map_key(args[0]) if args else '0'
            return _INT(sum(1 for e in data if _ekey(e) == key))
        if method_name == 'insert':
            val = args[0] if args else _INT(0)
            key = self._make_map_key(val)
            # Always insert (multiset allows duplicates)
            data.append({'key': key, 'val': val})
            data.sort(key=lambda e: self._set_sort_key(_ekey(e)))
            col['data'] = data
            save()
            self.memory.update_line(line)
            self._emit(line, f"{real_name}.insert({self._fmt(val)}).",
                       {'type': 'assign', 'target': real_name, 'value': self._fmt(val)})
            return _INT(0)
        if method_name == 'find':
            key = self._make_map_key(args[0]) if args else '0'
            for i, e in enumerate(data):
                if _ekey(e) == key:
                    return _mk_iter(i)
            return _end_iter()
        if method_name == 'erase':
            arg = args[0] if args else _INT(0)
            if isinstance(arg, dict) and arg.get('kind') == 'iterator':
                # erase by iterator — remove exactly one element
                idx = arg.get('idx')
                if idx is not None and 0 <= idx < len(data):
                    removed_key = _ekey(data[idx])
                    data.pop(idx)
                    col['data'] = data
                    save()
                    self.memory.update_line(line)
                    self._emit(line, f"{real_name}.erase(iter).",
                               {'type': 'assign', 'target': real_name, 'value': removed_key})
            else:
                # erase by value — remove ALL occurrences
                key = self._make_map_key(arg)
                col['data'] = [e for e in data if _ekey(e) != key]
                save()
                self.memory.update_line(line)
                self._emit(line, f"{real_name}.erase({key}).",
                           {'type': 'assign', 'target': real_name, 'value': key})
            return _INT(0)
        if method_name in ('begin',):
            return _mk_iter(0) if data else _end_iter()
        if method_name == 'end':
            return _end_iter()
        if method_name == 'rbegin':
            return _mk_iter(len(data) - 1) if data else _end_iter()
        if method_name == 'rend':
            return _end_iter()
        if method_name == 'clear':
            data[:] = []
            save()
            return _INT(0)
        if method_name in ('lower_bound', 'upper_bound'):
            key_val = args[0] if args else _INT(0)
            target = self._to_int(key_val)
            for i, e in enumerate(data):
                ev = self._to_int(_eval_e(e))
                if method_name == 'lower_bound' and ev >= target:
                    return _mk_iter(i)
                if method_name == 'upper_bound' and ev > target:
                    return _mk_iter(i)
            return _end_iter()
        return _INT(0)

    def _call_map_method(self, obj_name: str, obj_type: str, method_name: str,
                         args: list, line: int, arg_cursors=None) -> dict:
        """Handle map/unordered_map/set/unordered_set method calls."""
        real_name = obj_name[5:] if obj_name.startswith('this.') else obj_name
        is_set = 'set<' in obj_type and 'unordered_set<' not in obj_type or 'unordered_set<' in obj_type

        col = None
        is_this = False
        for frame in reversed(self.memory.stack):
            if real_name in frame['variables']:
                col = frame['variables'][real_name]
                break
        if col is None and self._this_stack:
            col = self._read_this_field(real_name, line)
            is_this = True

        if not isinstance(col, dict):
            col = {'kind': 'set' if is_set else 'map', 'data': [] if is_set else {}}
        if col.get('kind') not in ('map', 'set'):
            col = {'kind': 'set' if is_set else 'map', 'data': [] if is_set else {}}

        data = col.get('data', [] if is_set else {})

        def save():
            if is_this:
                self._write_this_field(real_name, col, line)
            elif real_name:
                self.memory.set_var(real_name, col)

        # ── helpers for set's list-of-entries format ─────────────────────
        # Each entry: {'key': str, 'val': dict}  (new format)
        # or bare string key (old format — kept for backwards compat)
        def _ekey(e):  return e['key'] if isinstance(e, dict) and 'key' in e else str(e)
        def _eval_e(e): return e.get('val', _INT(0)) if isinstance(e, dict) and 'key' in e else _INT(0)
        def _mk_iter(idx): return {'kind': 'iterator', 'data': data, 'idx': idx}
        def _end_iter():   return {'kind': 'iterator', 'data': data, 'idx': None}

        if method_name == 'size':
            return _INT(len(data))
        if method_name == 'empty':
            return _INT(int(len(data) == 0))
        if method_name in ('count', 'contains'):
            key = self._make_map_key(args[0]) if args else '0'
            if isinstance(data, dict):
                return _INT(1 if key in data else 0)
            return _INT(1 if any(_ekey(e) == key for e in data) else 0)
        if method_name == 'insert':
            val = args[0] if args else _INT(0)
            # Unwrap pair<K,V>: insert(make_pair(k, v)) → data[k] = v
            _pair_key = None; _pair_val = val
            if (isinstance(val, dict) and val.get('kind') == 'struct'):
                _f = val.get('fields', {})
                if 'first' in _f and 'second' in _f:
                    _pair_key = self._make_map_key(_f['first'])
                    _pair_val = _f['second']
            if isinstance(data, list):
                key = _pair_key if _pair_key is not None else self._make_map_key(val)
                ins_val = _pair_val if _pair_key is not None else val
                if not any(_ekey(e) == key for e in data):
                    data.append({'key': key, 'val': ins_val})
                    data.sort(key=lambda e: self._set_sort_key(_ekey(e)))
                col['data'] = data
                save()
            elif isinstance(data, dict):
                key = _pair_key if _pair_key is not None else self._make_map_key(val)
                ins_val = _pair_val if _pair_key is not None else val
                if key not in data:
                    data[key] = ins_val
                save()
            self.memory.update_line(line)
            self._emit(line, f"{real_name}.insert({self._fmt(val)}).",
                       {'type': 'assign', 'target': real_name, 'value': self._fmt(val)})
            return _INT(0)
        if method_name == 'erase':
            arg = args[0] if args else _INT(0)
            erased_key = ''
            if isinstance(data, dict):
                erased_key = self._make_map_key(arg)
                data.pop(erased_key, None)
            elif isinstance(data, list):
                if isinstance(arg, dict) and arg.get('kind') == 'iterator':
                    idx = arg.get('idx')
                    if idx is not None and 0 <= idx < len(data):
                        erased_key = _ekey(data[idx])
                        data.pop(idx)
                else:
                    erased_key = self._make_map_key(arg)
                    col['data'] = [e for e in data if _ekey(e) != erased_key]
                    data = col['data']
            save()
            self.memory.update_line(line)
            self._emit(line, f"{real_name}.erase({erased_key}).",
                       {'type': 'assign', 'target': real_name, 'value': erased_key})
            return _INT(0)
        if method_name == 'find':
            key = self._make_map_key(args[0]) if args else '0'
            if isinstance(data, dict):
                return _INT(1 if key in data else 0)
            for i, e in enumerate(data):
                if _ekey(e) == key:
                    return _mk_iter(i)
            return _end_iter()
        if method_name == 'end':
            if isinstance(data, list):
                return _end_iter()
            return _INT(0)
        if method_name == 'begin':
            if isinstance(data, list):
                return _mk_iter(0) if data else _end_iter()
            return _INT(1 if data else 0)
        if method_name == 'clear':
            if isinstance(data, dict):
                data.clear()
            else:
                data[:] = []
            save()
            return _INT(0)
        if method_name in ('lower_bound', 'upper_bound') and isinstance(data, list):
            key_val = args[0] if args else _INT(0)
            target = self._to_int(key_val)
            for i, e in enumerate(data):
                ev = self._to_int(_eval_e(e))
                if method_name == 'lower_bound' and ev >= target:
                    return _mk_iter(i)
                if method_name == 'upper_bound' and ev > target:
                    return _mk_iter(i)
            return _end_iter()
        if method_name == 'at' and isinstance(data, dict):
            key = self._make_map_key(args[0]) if args else '0'
            return data.get(key, _INT(0))
        if method_name in ('operator[]',) and isinstance(data, dict):
            key = self._make_map_key(args[0]) if args else '0'
            if key not in data:
                data[key] = _INT(0)
                save()
            return data.get(key, _INT(0))
        return _INT(0)

    def _call_string_method(self, obj_name: str, obj_c, method_name: str,
                            args: list, line: int) -> dict:
        """Handle std::string method calls."""
        real_name = obj_name[5:] if obj_name.startswith('this.') else obj_name

        s_val = None
        is_this = False
        if real_name:
            for frame in reversed(self.memory.stack):
                if real_name in frame['variables']:
                    s_val = frame['variables'][real_name]
                    break
        if s_val is None and self._this_stack:
            s_val = self._read_this_field(real_name, line)
            is_this = True

        if isinstance(s_val, dict) and s_val.get('kind') == 'char':
            s = s_val.get('value', '')
        else:
            s = ''

        def save(new_s):
            new_val = {'kind': 'char', 'value': new_s}
            if is_this:
                self._write_this_field(real_name, new_val, line)
            elif real_name:
                self.memory.set_var(real_name, new_val)

        if method_name in ('size', 'length'):
            return _INT(len(s))
        if method_name == 'empty':
            return _INT(int(len(s) == 0))
        if method_name == 'substr':
            pos = self._to_int(args[0]) if args else 0
            if len(args) > 1:
                ln = self._to_int(args[1])
                return {'kind': 'char', 'value': s[pos:pos + ln]}
            return {'kind': 'char', 'value': s[pos:]}
        if method_name == 'find':
            needle = args[0].get('value', '') if (args and isinstance(args[0], dict)) else ''
            result = s.find(needle)
            return _INT(result)
        if method_name in ('push_back', 'append', '__iadd__'):
            ch_val = args[0] if args else {'kind': 'char', 'value': ''}
            if isinstance(ch_val, dict):
                app = ch_val.get('value', '')
            else:
                app = chr(self._to_int(ch_val)) if isinstance(ch_val, (int, float)) else ''
            save(s + app)
            return _INT(0)
        if method_name == 'clear':
            save('')
            return _INT(0)
        if method_name == 'back':
            return {'kind': 'char', 'value': s[-1]} if s else {'kind': 'char', 'value': ''}
        if method_name == 'front':
            return {'kind': 'char', 'value': s[0]} if s else {'kind': 'char', 'value': ''}
        if method_name == 'pop_back':
            if s: save(s[:-1])
            return _INT(0)
        if method_name in ('begin', 'end'):
            return _INT(0)
        if method_name == 'erase':
            if not args:
                save('')
                return {'kind': 'char', 'value': s}
            pos = self._to_int(args[0])
            if len(args) > 1:
                ln = self._to_int(args[1])
                new_s = s[:pos] + s[pos + ln:]
            else:
                new_s = s[:pos]
            save(new_s)
            self._emit(line, f"{real_name}.erase({pos}).",
                       {'type': 'assign', 'target': real_name, 'value': new_s})
            return {'kind': 'char', 'value': s}
        if method_name == 'insert':
            if len(args) >= 2:
                pos = self._to_int(args[0])
                a1 = args[1]
                if isinstance(a1, dict) and a1.get('kind') == 'char':
                    ins = a1.get('value', '')
                elif isinstance(a1, (int, float)):
                    ins = chr(int(a1)) if 0 < int(a1) < 128 else ''
                else:
                    ins = str(a1) if a1 is not None else ''
                new_s = s[:pos] + ins + s[pos:]
                save(new_s)
                self._emit(line, f"{real_name}.insert({pos}, ...).",
                           {'type': 'assign', 'target': real_name, 'value': new_s})
                return {'kind': 'char', 'value': new_s}
            return {'kind': 'char', 'value': s}
        if method_name == 'replace':
            if len(args) >= 3:
                pos = self._to_int(args[0])
                ln  = self._to_int(args[1])
                rep = args[2].get('value', '') if isinstance(args[2], dict) else str(args[2])
                new_s = s[:pos] + rep + s[pos + ln:]
                save(new_s)
                self._emit(line, f"{real_name}.replace({pos}, {ln}, ...).",
                           {'type': 'assign', 'target': real_name, 'value': new_s})
                return {'kind': 'char', 'value': new_s}
            return {'kind': 'char', 'value': s}
        if method_name == 'at':
            idx = self._to_int(args[0]) if args else 0
            if not (0 <= idx < len(s)):
                self._crash(line, 'out-of-bounds',
                            f"string::at: index {idx} out of range (size={len(s)})")
            return {'kind': 'char', 'value': s[idx]}
        if method_name == 'compare':
            other = args[0].get('value', '') if (args and isinstance(args[0], dict)) else ''
            result = (s > other) - (s < other)
            return _INT(result)
        if method_name == 'rfind':
            needle = args[0].get('value', '') if (args and isinstance(args[0], dict)) else ''
            if isinstance(args[0], dict) and args[0].get('kind') == 'char' and len(needle) != 1:
                needle = needle  # substring rfind
            result = s.rfind(needle)
            return _INT(result)
        if method_name == 'c_str':
            return {'kind': 'char', 'value': s}
        if method_name == 'resize':
            new_len = self._to_int(args[0]) if args else len(s)
            fill_ch = args[1].get('value', '\0')[:1] if len(args) > 1 and isinstance(args[1], dict) else '\0'
            if new_len > len(s):
                new_s = s + fill_ch * (new_len - len(s))
            else:
                new_s = s[:new_len]
            save(new_s)
            return _INT(0)
        if method_name == 'reserve':
            return _INT(0)
        return _INT(0)

    # ── this-binding helpers ────────────────────────────────────────────────

    def _read_this_field(self, field: str, line: int):
        if not self._this_stack:
            return None
        b = self._this_stack[-1]
        if b.kind == 'stack':
            obj = (self.memory.stack[b.frame_idx]['variables'].get(b.var_name)
                   if b.frame_idx < len(self.memory.stack) else None)
            if isinstance(obj, dict) and obj.get('kind') == 'struct':
                return copy.deepcopy(obj['fields'].get(field))
        else:
            try:
                return self.memory.read_field(b.addr, field, line)
            except (SegFaultError, RuntimeError):
                pass
        return None

    def _write_this_field(self, field: str, value, line: int):
        if not self._this_stack:
            return
        b = self._this_stack[-1]
        if b.kind == 'stack':
            if b.frame_idx < len(self.memory.stack):
                obj = self.memory.stack[b.frame_idx]['variables'].get(b.var_name, {})
                if isinstance(obj, dict) and obj.get('kind') == 'struct':
                    obj['fields'][field] = value
                    self.memory.stack[b.frame_idx]['variables'][b.var_name] = obj
        else:
            try:
                self.memory.write_field(b.addr, field, value, line)
            except (SegFaultError, RuntimeError):
                pass

    def _binding_class_name(self, binding: _ThisBinding) -> str:
        if binding.class_name:
            return binding.class_name
        if binding.kind == 'stack':
            if binding.frame_idx < len(self.memory.stack):
                obj = self.memory.stack[binding.frame_idx]['variables'].get(binding.var_name, {})
                return self._infer_class(obj)
        else:
            block = self.memory.heap.get(binding.addr, {})
            return block.get('typeName', '')
        return ''

    def _infer_class(self, obj_val: dict) -> str:
        if not isinstance(obj_val, dict) or obj_val.get('kind') != 'struct':
            return ''
        f_set = set(obj_val.get('fields', {}).keys())
        for cname, cd in self.class_defs.items():
            if set(cd['fields'].keys()) == f_set:
                return cname
        return ''

    # ── Array init helpers ───────────────────────────────────────────────────

    def _init_c_array(self, cursor, children: list) -> dict:
        type_spell = cursor.type.spelling    # e.g. "int [5]" or "int [3][3]"
        dims       = [int(d) for d in re.findall(r'\[(\d+)\]', type_spell)]

        # char name[] = "hello" — store as a string value, not a zero-filled int array
        if type_spell.startswith('char') and len(dims) == 1 and children:
            for child in children:
                sv = self._extract_string_literal(child)
                if sv is not None:
                    return {'kind': 'char', 'value': sv}

        # Find the INIT_LIST_EXPR child (the array size literal may also be a child)
        init_c = next(
            (c for c in children if c.kind == CK.INIT_LIST_EXPR),
            children[0] if children else None,
        )

        # Arrays with declared size above this threshold use lazy/sparse storage:
        # start empty and grow only as indices are actually written.
        # This handles the CP pattern of large buffers like `int dp[200010]`
        # where only indices 0..n are ever touched.
        _LAZY_THRESHOLD = 256

        if len(dims) == 2:
            rows, cols = dims
            has_init = init_c and init_c.kind == CK.INIT_LIST_EXPR
            if rows > _LAZY_THRESHOLD and not has_init:
                # Start with no rows; rows extend lazily on write
                return {'kind': 'array', 'values': [], 'rows': rows, 'cols': cols, 'declared_size': rows}
            cap_r  = min(rows, _LAZY_THRESHOLD)
            cap_c  = min(cols, _LAZY_THRESHOLD)
            values = [[0] * cap_c for _ in range(cap_r)]
            if has_init:
                for ri, row_c in enumerate(self._ch(init_c)):
                    if ri >= cap_r: break
                    if row_c.kind == CK.INIT_LIST_EXPR:
                        for ci, e in enumerate(self._ch(row_c)):
                            if ci < cap_c:
                                values[ri][ci] = self._to_int(self._eval(e))
                    else:
                        values[ri][0] = self._to_int(self._eval(row_c))
            return {'kind': 'array', 'values': values, 'rows': rows, 'cols': cols, 'declared_size': rows}

        if len(dims) == 1:
            size = dims[0]
            has_init = init_c and init_c.kind == CK.INIT_LIST_EXPR
            if size > _LAZY_THRESHOLD and not has_init:
                # Start empty; extends lazily on write
                return {'kind': 'array', 'values': [], 'declared_size': size}
            cap  = min(size, _LAZY_THRESHOLD)
            is_char_arr = type_spell.lower().startswith('char')
            vals = [{'kind': 'char', 'value': '\0'} if is_char_arr else 0] * cap
            if has_init:
                for ci, e in enumerate(self._ch(init_c)):
                    if ci < cap:
                        v = self._eval(e)
                        vals[ci] = v if is_char_arr else self._to_int(v)
            return {'kind': 'array', 'values': vals, 'declared_size': size}

        return {'kind': 'array', 'values': []}

    def _extract_string_literal(self, cursor) -> str | None:
        """Walk cursor tree looking for a STRING_LITERAL; return its string value or None."""
        if cursor is None:
            return None
        if cursor.kind == CK.STRING_LITERAL:
            val = self._eval_string_lit(cursor)
            return val.get('value', '')
        for child in self._ch(cursor):
            result = self._extract_string_literal(child)
            if result is not None:
                return result
        return None

    # ── Operator extraction via tokens ───────────────────────────────────────

    def _get_binary_op(self, cursor) -> str:
        ch = self._ch(cursor)
        if len(ch) < 2:
            return '+'
        left, right = ch[0], ch[1]
        l_end  = left.extent.end.offset
        r_start = right.extent.start.offset

        # Alternative-token keywords map (C++ ISO alternative representations)
        _alt_kw = {'and': '&&', 'or': '||', 'not_eq': '!=',
                   'bitand': '&', 'bitor': '|', 'xor': '^'}

        # Scan tokens strictly between the two children
        for tok in cursor.get_tokens():
            ts = tok.extent.start.offset
            te = tok.extent.end.offset
            if ts >= l_end and te <= r_start:
                if tok.kind == TK.PUNCTUATION:
                    sp = tok.spelling
                    if sp not in ('(', ')', '[', ']', '{', '}', ',', ';', '...'):
                        return sp
                elif tok.kind == TK.KEYWORD and tok.spelling in _alt_kw:
                    return _alt_kw[tok.spelling]

        # Fallback: first punctuation/keyword-op token not in either child's range
        l_range = (left.extent.start.offset,  left.extent.end.offset)
        r_range = (right.extent.start.offset, right.extent.end.offset)
        for tok in cursor.get_tokens():
            ts = tok.extent.start.offset
            if l_range[0] <= ts < l_range[1]: continue
            if r_range[0] <= ts < r_range[1]: continue
            if tok.kind == TK.PUNCTUATION:
                sp = tok.spelling
                if sp not in ('(', ')', '[', ']', '{', '}', ',', ';', '...'):
                    return sp
            elif tok.kind == TK.KEYWORD and tok.spelling in _alt_kw:
                return _alt_kw[tok.spelling]
        return '+'

    def _get_unary_op(self, cursor) -> str:
        toks = list(cursor.get_tokens())
        if not toks:
            return ''
        first = toks[0]
        if first.kind == TK.KEYWORD:
            kw = first.spelling
            if kw in ('sizeof', 'alignof', 'delete', 'new', 'not'):
                return kw
        if first.kind == TK.PUNCTUATION:
            sp = first.spelling
            if sp in ('!', '-', '+', '*', '&', '~'):
                return sp
            if sp == '++': return '++'
            if sp == '--': return '--'
        # Postfix: last token
        last = toks[-1]
        if last.kind == TK.PUNCTUATION:
            if last.spelling == '++': return 'p++'
            if last.spelling == '--': return 'p--'
        return ''

    # ── AST utilities ────────────────────────────────────────────────────────

    def _ch(self, cursor) -> list:
        return list(cursor.get_children())

    def _unwrap(self, cursor):
        """If cursor is a transparent wrapper, return its first real child."""
        if cursor is None:
            return None
        if cursor.kind in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR,
                           CK.CXX_STATIC_CAST_EXPR,
                           CK.CSTYLE_CAST_EXPR, CK.CXX_FUNCTIONAL_CAST_EXPR):
            ch = self._ch(cursor)
            return ch[0] if ch else None
        return cursor

    def _body_of(self, func_cursor):
        for c in self._ch(func_cursor):
            if c.kind == CK.COMPOUND_STMT:
                return c
        return None

    def _get_params(self, func_cursor) -> list:
        return [c for c in self._ch(func_cursor) if c.kind == CK.PARM_DECL]

    def _cursor_name(self, cursor) -> str:
        if cursor is None:
            return ''
        k = cursor.kind
        if k == CK.DECL_REF_EXPR:
            return cursor.spelling
        if k == CK.MEMBER_REF_EXPR:
            ch = self._ch(cursor)
            obj = self._cursor_name(ch[0]) if ch else 'this'
            return f'{obj}.{cursor.spelling}'
        if k in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR):
            ch = self._ch(cursor)
            if ch:
                return self._cursor_name(ch[0])
            # Dependent-type UNEXPOSED_EXPR with no children: recover from tokens
            toks = [t.spelling for t in cursor.get_tokens()]
            if len(toks) == 1 and toks[0].isidentifier():
                return toks[0]
            return ''
        return cursor.spelling or ''

    # ── Type helpers ─────────────────────────────────────────────────────────

    def _base_type(self, type_spell: str) -> str:
        s = (type_spell
             .replace('const ', '').replace('volatile ', '')
             .replace('*', '').replace('&', '').strip())
        # Strip array dimensions: "Student [3]" → "Student", "int [3][3]" → "int"
        bracket = s.find('[')
        if bracket != -1:
            s = s[:bracket].strip()
        if s.startswith('std::'):
            s = s[5:]
        # Strip template params: 'MyStack<int>' → 'MyStack'
        bracket = s.find('<')
        if bracket != -1:
            s = s[:bracket].strip()
        return s

    def _is_vector_type(self, type_spell: str) -> bool:
        # Exclude iterator types (std::vector<int>::iterator is NOT a vector variable)
        if '::iterator' in type_spell or '::const_iterator' in type_spell:
            return False
        return 'vector<' in type_spell or type_spell == 'vector'

    def _is_class_type(self, type_spell: str) -> bool:
        return self._base_type(type_spell) in self.class_defs

    def _simple_type(self, type_spell: str) -> str:
        """Convert C++ type string to the simplified form Memory understands."""
        ts = type_spell.lower()
        if 'char' in ts:        return 'char'
        # Fixed-size array of pointers: "Type *[N]"  (e.g. TrieNode *[26])
        if '*' in type_spell:
            m = re.search(r'\*\s*\[(\d+)\]', type_spell)
            if m:
                return f'ptr_array:{m.group(1)}'
            return f'ptr:{self._base_type(type_spell)}'
        if 'vector' in ts:      return 'array'
        return 'int'

    def _default_for_type(self, type_spell: str) -> dict:
        ts  = type_spell.lower()
        # Fixed-size C array: "int[10]", "long long[5]", "vector<int>[6]", etc.
        # Must be checked BEFORE the plain-vector check.
        m = re.search(r'\[(\d+)\]', type_spell)
        if m and '*' not in type_spell:
            n = int(m.group(1))
            if 'vector' in ts:
                # array of N empty vectors
                return {'kind': 'array', 'values': [{'kind': 'array', 'values': []} for _ in range(n)]}
            # 2-D: int[R][C]
            m2 = re.search(r'\[(\d+)\]\[(\d+)\]', type_spell)
            if m2:
                rows, cols = int(m2.group(1)), int(m2.group(2))
                return {'kind': 'array', 'values': [[0]*cols for _ in range(rows)],
                        'rows': rows, 'cols': cols}
            return {'kind': 'array', 'values': [0] * n}
        # vector check must come before primitive checks — 'vector<vector<int>>' contains 'int'
        if 'vector' in ts:
            return {'kind': 'array', 'values': []}
        if any(t in ts for t in ('int', 'long', 'short', 'unsigned',
                                  'size_t', 'bool', 'float', 'double')):
            return _INT(0)
        if 'char' in ts or ts in ('string', 'std::string'):
            return {'kind': 'char', 'value': ''}
        if '*' in type_spell:
            return {'kind': 'pointer', 'address': None}
        base = self._base_type(type_spell)
        if base in self.class_defs:
            return {'kind': 'struct', 'fields': {
                f: self._default_for_type(t)
                for f, t in self.class_defs[base]['fields'].items()
            }}
        return _INT(0)

    # ── Trace emission ───────────────────────────────────────────────────────

    def _adj(self, raw_line: int) -> int:
        """Convert libclang line (including stub offset) to user source line."""
        if raw_line <= 0:
            return raw_line
        return max(1, raw_line - self._line_offset)

    def _emit(self, line: int, description: str, event: dict):
        self.step_count += 1
        if self.step_count > MAX_STEPS:
            raise TraceTruncated(
                f'Trace truncated after {MAX_STEPS} steps. '
                f'Try a smaller input to see the full execution.'
            )
        adj = self._adj(line) if line > 0 else line
        self.trace.append({
            'index':       len(self.trace),
            'line':        adj,
            'description': description,
            'event':       event,
            'memory':      self.memory.snapshot(),
        })

    # ── Value utilities ──────────────────────────────────────────────────────

    def _truthy(self, val) -> bool:
        if val is None: return False
        if isinstance(val, dict):
            k = val.get('kind')
            if k == 'int':     return val.get('value', 0) != 0
            if k == 'float':   return val.get('value', 0.0) != 0.0
            if k == 'pointer': return val.get('address') is not None
            if k == 'char':    return val.get('value', '') not in ('', '\0')
            if k == 'array':   return True
            if k == 'struct':  return True
        return bool(val)

    def _to_int(self, val):
        """Return the numeric value of val (may be int or float)."""
        if val is None:                    return 0
        if isinstance(val, (int, float)):  return val
        if isinstance(val, dict):
            k = val.get('kind')
            if k == 'int':     return val.get('value', 0)
            if k == 'float':   return val.get('value', 0.0)
            if k == 'pointer': return 0 if val.get('address') is None else 1
            if k == 'char':
                v = val.get('value', '')
                if not v: return 0
                # decode 2-char escape sequences stored as raw text (e.g. backslash+n)
                v = v.replace('\\n', '\n').replace('\\t', '\t').replace('\\r', '\r')
                v = v.replace('\\0', '\0').replace('\\\\', '\\').replace("\\'", "'")
                return ord(v[0]) if v else 0
            if k == 'map':      return len(val.get('data', {}))
            if k == 'array':    return len(val.get('values', []))
            if k == 'iterator': return val.get('idx', 0) if val.get('idx') is not None else 0
        return 0

    def _pointer_advance(self, ptr: dict, delta: int, line: int) -> dict:
        """Advance a pointer by delta elements.

        For heap-allocated arrays (blocks with '_arr' field), we track an integer
        offset inside the block.  For struct pointers we keep the same address (the
        pointer is now dangling/past-end — future dereferences will crash).
        """
        addr = ptr.get('address')
        offset = ptr.get('offset', 0)
        new_offset = offset + delta
        if addr and addr in self.memory.heap:
            block = self.memory.heap[addr]
            arr = block['fields'].get('_arr')
            if arr and arr.get('kind') == 'array':
                # Pointer into a malloc'd array: track element offset inside the block
                return {'kind': 'pointer', 'address': addr, 'offset': new_offset}
        # Struct pointer or unknown — keep address, record offset (used for dangling checks)
        return {'kind': 'pointer', 'address': addr, 'offset': new_offset}

    # ── Vector buffer heap simulation (iterator invalidation visualization) ──

    def _vec_alloc_buf(self, name: str, size: int, line: int) -> str:
        """Inject a synthetic heap block representing a vector's internal buffer."""
        from .memory import _new_addr
        addr = _new_addr()
        self.memory.heap[addr] = {
            'address': addr,
            'size': size,
            'typeName': f'{name}[ ] buffer',
            'state': 'allocated',
            'fields': {},
            'allocatedAtLine': line,
        }
        self._vec_buf_addrs[name] = addr
        self._emit(line, f"{name} buffer allocated at {addr}",
                   {'type': 'malloc', 'address': addr, 'size': size, 'typeName': f'{name}[ ] buffer'})
        return addr

    def _vec_free_buf(self, name: str, line: int):
        """Mark a vector's current buffer as freed (reallocation)."""
        addr = self._vec_buf_addrs.get(name)
        if addr and addr in self.memory.heap:
            self.memory.heap[addr]['state'] = 'freed'
            self.memory.heap[addr]['freedAtLine'] = line
            self._emit(line, f"{name} buffer freed — reallocation",
                       {'type': 'free', 'address': addr})

    def _warn(self, line: int, kind: str, message: str):
        """Emit a non-fatal warning step. Execution continues after this."""
        adj  = self._adj(line)
        desc = f'⚠ Line {adj}: {message}' if adj > 0 else f'⚠ {message}'
        self.memory.update_line(line)
        self.trace.append({
            'index':       len(self.trace),
            'line':        adj,
            'description': desc,
            'event': {'type': 'warning', 'kind': kind, 'message': message},
            'memory':      self.memory.snapshot(),
        })

    def _crash(self, line: int, kind: str, message: str):
        """Emit a crash step and raise SegFaultError to stop execution."""
        adj = self._adj(line)
        desc = f'Line {adj}: {message}' if adj > 0 else message
        self.memory.update_line(line)
        self.trace.append({
            'index':       len(self.trace),
            'line':        adj,
            'description': desc,
            'event': {'type': 'crash', 'kind': kind, 'message': desc, 'address': None},
            'memory':      self.memory.snapshot(),
        })
        raise SegFaultError(kind, desc, None, line)

    # ── Centralised array mutation helpers ──────────────────────────────────
    # All array writes go through one of these two methods so that lastWrite
    # is always set and value coercion is consistent everywhere.

    def _arr_set(self, arr: dict, indices: list, val, line: int = 0):
        """Write val into arr at indices ([i] or [row, col]).
        Preserves pointer/struct dicts; coerces scalars to int.
        Sets lastWrite, returns the stored value (for emit messages).
        Raises crash on out-of-bounds if line is provided."""
        # Preserve pointer, struct, and single-char dicts as-is; coerce everything else to int
        is_rich = isinstance(val, dict) and val.get('kind') not in ('int',)
        store_val = val if is_rich else self._to_int(val)
        coerced   = self._to_int(val)   # for emit / return compat
        vals = arr.get('values', [])
        declared = arr.get('declared_size')  # may be larger than len(vals) for lazy arrays
        if len(indices) == 1:
            i = indices[0]
            if 0 <= i and (declared is None or i < declared):
                if len(vals) <= i:
                    vals.extend([0] * (i - len(vals) + 1))
                vals[i] = store_val
            elif line:
                self._crash(line, 'out-of-bounds',
                            f"Index {i} out of bounds for array of size {declared or len(vals)}")
        elif len(indices) == 2:
            r, c = indices
            n_rows = arr.get('rows')
            n_cols = arr.get('cols')
            # Matrix-style vectors (rows/cols set): strict bounds. Adjacency lists: allow extension.
            if n_rows is not None and not (0 <= r < n_rows):
                if line:
                    self._crash(line, 'out-of-bounds',
                                f"Row index {r} out of bounds for {n_rows}x{n_cols} matrix")
            elif declared is not None and not (0 <= r < declared):
                if line:
                    self._crash(line, 'out-of-bounds',
                                f"Row index {r} out of bounds for array of size {declared}")
            else:
                declared_c = len(vals[0]) if vals and isinstance(vals[0], list) else 0
                if len(vals) <= r:
                    vals.extend([[0] * declared_c if declared_c else [] for _ in range(r - len(vals) + 1)])
                row = vals[r]
                if isinstance(row, list):
                    if n_cols is not None and not (0 <= c < n_cols):
                        if line:
                            self._crash(line, 'out-of-bounds',
                                        f"Column index {c} out of bounds for {n_cols}-element row")
                    else:
                        if len(row) <= c:
                            row.extend([0] * (c - len(row) + 1))
                        row[c] = store_val
        arr['values']    = vals
        arr['lastWrite'] = list(indices)
        # Return a display-friendly value for emit messages
        if is_rich and val.get('kind') == 'pointer':
            return val.get('address') or 'NULL'
        return coerced

    def _arr_push(self, arr: dict, val) -> object:
        """Append val to arr, set lastWrite to the new tail index.
        Preserves struct/inner-array dicts; coerces everything else to plain int.
        Returns the stored value."""
        stored = (val if isinstance(val, dict) and val.get('kind') in ('struct', 'array')
                  else self._to_int(val))
        vals = arr.get('values', [])
        vals.append(stored)
        arr['values']    = vals
        arr['lastWrite'] = [len(vals) - 1]
        return stored

    def _fmt(self, val) -> str:
        if val is None: return 'void'
        if isinstance(val, dict):
            k = val.get('kind')
            if k == 'int':      return str(val.get('value', 0))
            if k == 'float':    return f"{val.get('value', 0.0):.6g}"
            if k == 'pointer':  return val.get('address') or 'nullptr'
            if k == 'char':     return f"'{val.get('value', '')}'"
            if k == 'struct':   return '{...}'
            if k == 'array':    return f"[{len(val.get('values', []))} elems]"
            if k == 'map':      return f"map({len(val.get('data', {}))})"
            if k == 'set':      return f"set({len(val.get('data', []))})"
            if k == 'iterator':
                idx = val.get('idx')
                return 'end()' if idx is None else f'iterator[{idx}]'
        return str(val)

    def _scanf_inner_cursor(self, cursor):
        """Given an &var or &arr[i] cursor, return the inner lvalue cursor to write to."""
        if cursor is None:
            return None
        ch = self._ch(cursor)
        k = cursor.kind
        # UNARY_OPERATOR '&expr' — unwrap one level
        if k == CK.UNARY_OPERATOR and ch:
            return ch[0]
        # Already an lvalue (DECL_REF_EXPR, ARRAY_SUBSCRIPT_EXPR, etc.)
        if k in (CK.DECL_REF_EXPR, CK.ARRAY_SUBSCRIPT_EXPR, CK.MEMBER_REF_EXPR):
            return cursor
        # Wrapped in UNEXPOSED_EXPR / PAREN_EXPR
        if k in (CK.UNEXPOSED_EXPR, CK.PAREN_EXPR) and ch:
            return self._scanf_inner_cursor(ch[0])
        return cursor

    def _exec_scanf(self, arg_cursors, line: int) -> dict:
        """Implement scanf: parse format string, read stdin tokens, write to pointer args."""
        import re
        if not arg_cursors:
            return _INT(0)

        # Evaluate the format string (first arg)
        fmt_val = self._eval(arg_cursors[0])
        fmt_str = fmt_val.get('value', '') if isinstance(fmt_val, dict) else str(fmt_val)

        # Extract format specifiers in order: %d %i %u %ld %lld %f %lf %s %c
        specifiers = re.findall(r'%(\*?)(?:\d+)?(?:h|l{1,2}|L)?([diouxXeEfgGcs])', fmt_str)
        # specifiers is list of (suppress_flag, type_char)

        ptr_cursors = arg_cursors[1:]  # skip format string
        written = 0
        ptr_idx = 0

        for suppress, type_char in specifiers:
            token = None
            if self._stdin_pos < len(self._stdin_tokens):
                token = self._stdin_tokens[self._stdin_pos]
                self._stdin_pos += 1

            if suppress == '*':
                # Assignment suppression — consume token but don't write
                continue

            if ptr_idx >= len(ptr_cursors):
                break

            inner = self._scanf_inner_cursor(ptr_cursors[ptr_idx])
            ptr_idx += 1

            if token is None:
                break

            if type_char in ('d', 'i', 'o', 'u', 'x', 'X'):
                try:
                    val = _INT(int(token, 0) if type_char in ('o', 'x', 'X') else int(token))
                except ValueError:
                    val = _INT(0)
            elif type_char in ('f', 'e', 'E', 'g', 'G'):
                try:
                    val = _INT(int(float(token)))
                except ValueError:
                    val = _INT(0)
            elif type_char == 's':
                val = {'kind': 'char', 'value': token}
            elif type_char == 'c':
                val = {'kind': 'char', 'value': token[0] if token else ''}
            else:
                val = _INT(0)

            if inner is not None:
                self._write_lval(inner, val, line)
                written += 1

        return _INT(written)

    def _exec_printf(self, fmt_cursor, args: list) -> str:
        """Implement printf: substitute format specifiers with arg values, return output string."""
        import re
        if fmt_cursor is None:
            return ''
        fmt_val = self._eval(fmt_cursor)
        fmt_str = fmt_val.get('value', '') if isinstance(fmt_val, dict) else str(fmt_val)

        # Replace escape sequences
        fmt_str = fmt_str.replace('\\n', '\n').replace('\\t', '\t').replace('\\r', '\r').replace('\\\\', '\\')

        arg_idx = 0
        result = []
        i = 0
        while i < len(fmt_str):
            if fmt_str[i] != '%':
                result.append(fmt_str[i])
                i += 1
                continue
            i += 1
            if i >= len(fmt_str):
                break
            if fmt_str[i] == '%':
                result.append('%')
                i += 1
                continue
            # Consume flags, width, precision, length modifier
            j = i
            while j < len(fmt_str) and fmt_str[j] in '0123456789+-. *hljztL':
                j += 1
            if j >= len(fmt_str):
                break
            spec = fmt_str[j]
            i = j + 1
            if arg_idx >= len(args):
                continue
            val = args[arg_idx]
            arg_idx += 1
            n = self._to_int(val)
            if spec in ('d', 'i'):
                result.append(str(n))
            elif spec in ('u',):
                result.append(str(n & 0xFFFFFFFFFFFFFFFF))
            elif spec in ('f', 'e', 'E', 'g', 'G'):
                result.append(f'{float(n):.6f}')
            elif spec in ('x',):
                result.append(hex(n)[2:])
            elif spec in ('X',):
                result.append(hex(n)[2:].upper())
            elif spec in ('o',):
                result.append(oct(n)[2:])
            elif spec == 's':
                if isinstance(val, dict):
                    if val.get('kind') == 'char':
                        sv = val.get('value', '')
                    elif val.get('kind') == 'array':
                        # char[] stored as int array — convert non-null elements to chars
                        sv = ''.join(
                            chr(self._to_int(v)) if 32 <= self._to_int(v) <= 126 else ''
                            for v in val.get('values', [])
                            if self._to_int(v) != 0
                        )
                    elif val.get('kind') == 'pointer':
                        addr = val.get('address')
                        if addr and addr in self.memory.heap:
                            fv = self.memory.heap[addr]['fields'].get('value', _INT(0))
                            sv = fv.get('value', '') if isinstance(fv, dict) else str(self._to_int(fv))
                        else:
                            sv = ''
                    else:
                        sv = str(n)
                else:
                    sv = str(n)
                result.append(sv)
            elif spec == 'c':
                result.append(chr(n) if 0 <= n <= 127 else '?')
            else:
                result.append(str(n))

        return ''.join(result)

    def _cin_read_next(self, type_spell: str = '') -> dict:
        """Consume the next whitespace-delimited token from stdin and return as an interpreter value."""
        if self._stdin_pos >= len(self._stdin_tokens):
            base = type_spell.replace('const ', '').replace('&', '').strip()
            if 'string' in base or base == 'char':
                return {'kind': 'char', 'value': ''}
            return _INT(0)
        token = self._stdin_tokens[self._stdin_pos]
        self._stdin_pos += 1
        base = type_spell.replace('const ', '').replace('&', '').strip()
        if base == 'char':
            return {'kind': 'char', 'value': token[0] if token else ''}
        if 'string' in base:
            return {'kind': 'char', 'value': token}
        try:
            return _INT(int(token))
        except ValueError:
            pass
        try:
            return _INT(int(float(token)))
        except ValueError:
            pass
        return {'kind': 'char', 'value': token}

    def _val_to_output_text(self, val) -> str:
        """Convert an interpreter value to its string output representation."""
        if val is None: return ''
        if isinstance(val, (int, float)): return str(int(val))
        if isinstance(val, dict):
            k = val.get('kind')
            if k == 'int':     return str(val.get('value', 0))
            if k == 'float':
                v = val.get('value', 0.0)
                prec = self._output_precision
                if self._output_fixed and prec >= 0:
                    return f"{v:.{prec}f}"
                if self._output_fixed:
                    return f"{v:.6f}"
                if prec >= 0:
                    return f"{v:.{prec}g}"
                return f"{v:.6g}"
            if k == 'char':    return val.get('value', '')
            if k == 'pointer': return val.get('address') or 'NULL'
            if k == 'array':   return str(val.get('values', []))
            if k == 'map':     return str(val.get('data', {}))
            if k == 'set':     return str(sorted(val.get('data', [])))
            if k == 'struct':
                f = val.get('fields', {})
                if 'first' in f and 'second' in f:
                    return (f"({self._val_to_output_text(f['first'])}"
                            f",{self._val_to_output_text(f['second'])})")
                return '{...}'
        return ''


# ── Module-level helper ──────────────────────────────────────────────────────

def _INT(v: int) -> dict:
    return {'kind': 'int', 'value': v}

def _FLOAT(v: float) -> dict:
    return {'kind': 'float', 'value': float(v)}

def _is_float_val(v) -> bool:
    """True if v is a float-kind dict."""
    return isinstance(v, dict) and v.get('kind') == 'float'
