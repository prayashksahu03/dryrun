"""
C++ → C preprocessing for MemTrace.
Supports the competitive-programming subset of C++:
  - vector<T>(n) / vector<vector<T>>(m, vector<T>(n)) → C arrays
  - long long → long, auto → int, bool → int, nullptr → NULL
  - cout/cin/using namespace stripped
  - min/max/abs renamed to __min/__max/__abs (handled as builtins)
  - Simple #define constants expanded
"""
from __future__ import annotations
import re


def preprocess_cpp(source: str) -> str:
    """Convert C++ source to C. Returns C source string."""
    # 1. Expand simple #define constants (blank out the #define line)
    source = _expand_defines(source)

    # 2. Process line by line
    lines = source.split('\n')
    out = [_transform_line(ln) for ln in lines]
    source = '\n'.join(out)

    # 3. Rename stdlib calls the interpreter handles as builtins
    source = re.sub(r'\bmin\s*\(', '__min(', source)
    source = re.sub(r'\bmax\s*\(', '__max(', source)
    source = re.sub(r'\babs\s*\(', '__abs(', source)

    # 4. Erase single-line STL algorithm calls
    source = re.sub(
        r'^\s*(?:sort|fill|reverse|fill_n|memset|memcpy|swap)\s*\([^;]*\)\s*;',
        ';',
        source,
        flags=re.MULTILINE,
    )

    return source


# ── Define expansion ───────────────────────────────────────────────────

def _expand_defines(source: str) -> str:
    defines: dict[str, str] = {}
    lines = []
    for line in source.split('\n'):
        m = re.match(r'^\s*#define\s+(\w+)\s+(.*?)\s*$', line)
        if m:
            name, value = m.group(1), m.group(2)
            # Only simple non-function-like macros with no parens
            if '(' not in name and '(' not in value:
                defines[name] = value
            lines.append('')  # blank — preserves line numbers
        else:
            lines.append(line)

    if not defines:
        return '\n'.join(lines)

    result = '\n'.join(lines)
    for name, value in defines.items():
        result = re.sub(r'\b' + re.escape(name) + r'\b', value, result)
    return result


# ── Per-line transforms ────────────────────────────────────────────────

def _transform_line(line: str) -> str:
    s = line.strip()

    # Blank out lines that have no C equivalent
    if _should_strip(s):
        return ''

    # Type / keyword substitutions (in-place, preserving indentation)
    line = re.sub(r'\bunsigned\s+long\s+long\b', 'unsigned long', line)
    line = re.sub(r'\blong\s+long\b', 'long', line)
    line = re.sub(r'\bauto\b', 'int', line)
    line = re.sub(r'\bbool\b', 'int', line)
    line = re.sub(r'\btrue\b', '1', line)
    line = re.sub(r'\bfalse\b', '0', line)
    line = line.replace('nullptr', 'NULL')

    # Strip std:: prefix
    line = re.sub(r'\bstd\s*::\s*', '', line)

    # string → char* (rough, handles most simple cases)
    line = re.sub(r'\bstring\b', 'char*', line)

    # Strip member calls on vectors/strings (push_back, size, etc.)
    # Replace with a semicolon so surrounding syntax stays valid
    line = re.sub(
        r'\.\s*(?:push_back|pop_back|emplace_back|clear|resize|'
        r'begin|end|front|back|empty|size)\s*\([^)]*\)',
        '',
        line,
    )

    # vector<vector<T>> name(rows, vector<T>(cols[, init])) → T name[rows][cols]
    line = _vec2d(line)
    # vector<T> name(size[, init]) → T name[size]
    line = _vec1d(line)

    return line


_STRIP_PATTERNS = [
    # using namespace X  /  using std::X
    re.compile(r'^using\s+(?:namespace\s+\w+|\w+\s*::\s*\w+)\s*;?$'),
    # cout << ... / cerr << ...
    re.compile(r'^(?:std\s*::\s*)?(?:cout|cerr)\s*<<'),
    # cin >> ...
    re.compile(r'^(?:std\s*::\s*)?cin\s*>>'),
    # ios_base::... or cin.tie / cout.tie
    re.compile(r'^ios(?:_base)?\s*(?:::|\.)|^cin\s*\.|^cout\s*\.'),
    # Blank / comment-only lines — leave as-is (no strip)
]


def _should_strip(stripped: str) -> bool:
    if not stripped:
        return False
    for pat in _STRIP_PATTERNS:
        if pat.match(stripped):
            return True
    return False


# ── Vector → array ─────────────────────────────────────────────────────

_VEC2D = re.compile(
    r'^(\s*)vector\s*<\s*vector\s*<\s*(\w+)\s*>\s*>\s+(\w+)\s*'
    r'\(\s*([^,()]+?)\s*,\s*vector\s*<\s*\w+\s*>\s*\(\s*([^,()]+?)\s*'
    r'(?:,\s*[^()]+?)?\s*\)\s*\)\s*;'
)
_VEC1D = re.compile(
    r'^(\s*)vector\s*<\s*(\w+)\s*>\s+(\w+)\s*'
    r'\(\s*([^,()]+?)\s*(?:,\s*[^()]+?)?\s*\)\s*;'
)


def _vec2d(line: str) -> str:
    m = _VEC2D.match(line)
    if m:
        indent, typ, name, rows, cols = m.groups()
        return f'{indent}{typ} {name}[{rows.strip()}][{cols.strip()}];'
    return line


def _vec1d(line: str) -> str:
    m = _VEC1D.match(line)
    if m:
        indent, typ, name, size = m.groups()
        return f'{indent}{typ} {name}[{size.strip()}];'
    return line
