#!/usr/bin/env python3
"""Regression harness for C++ interpreter bugs that produced SILENTLY WRONG output.

Every case here once traced "successfully" while printing the wrong thing — the
worst failure mode for a tool whose promise is that the trace is real. Each
expectation was verified against `g++ -std=c++17`, not assumed.

Usage:
    cd backend && (.venv/bin/uvicorn main:app --port 8765 &)
    python3 tests/regressions.py [port]      # default 8765

Add a case whenever a wrong-output bug is found, BEFORE fixing it.
"""
import json, sys, urllib.request

PORT = sys.argv[1] if len(sys.argv) > 1 else '8765'
URL  = f'http://localhost:{PORT}/execute'

# ── The program that started it all ──────────────────────────────────────
# Reported by a user: printed "No" when g++ prints "Yes". Two independent
# causes — vector::assign was never dispatched, and `struct Dsu {...} dsu;`
# (inline instance declarator) created the variable as a plain int 0.
TREE_RECONSTRUCT = r'''#include <iostream>
#include <vector>
#include <algorithm>
#include <string>
#include <utility>
using namespace std;
constexpr int N = 105;
int n, id[N], cnt[N];
bool vs[N], e[N][N];
bool reach[N];
struct Dsu {
    int fa[N];
    void init(int n) { for (int i = 1; i <= n; i++) fa[i] = i; }
    int find(int x) { if (x == fa[x]) return x; return fa[x] = find(fa[x]); }
    void merge(int x, int y) { fa[find(x)] = find(y); }
} dsu;
vector<vector<int>> tree;
void search(int u) {
    reach[u] = true;
    for (int v : tree[u]) search(v);
}
int main() {
    cin >> n;
    tree.assign(n + 1, vector<int>());
    for (int i = 1; i <= n; i++) { cnt[i] = 0; tree[i].clear(); }
    for (int u = 1; u <= n; u++) {
        id[u] = u;
        string s; cin >> s;
        for (int v = 1; v <= n; v++) { e[u][v] = s[v-1] - '0'; cnt[u] += e[u][v]; }
    }
    sort(id + 1, id + n + 1, [&](int u, int v) { return cnt[u] > cnt[v]; });
    vector<pair<int,int>> edges;
    for (int u = 1; u <= n; u++) {
        for (int i = 1; i <= n; i++) vs[i] = false;
        vs[u] = true;
        for (int i = 1; i <= n; i++) {
            int v = id[i];
            if (!vs[v] && e[u][v]) {
                edges.push_back({u, v});
                if ((int)edges.size() >= n) { cout << "No\n"; return 0; }
                for (int w = 1; w <= n; w++) if (e[v][w]) vs[w] = true;
            }
        }
    }
    if ((int)edges.size() != n - 1) { cout << "No\n"; return 0; }
    sort(edges.begin(), edges.end());
    dsu.init(n);
    for (int i = 0; i < (int)edges.size(); i++) {
        dsu.merge(edges[i].first, edges[i].second);
        tree[edges[i].first].push_back(edges[i].second);
    }
    int flag = 1;
    for (int i = 1; i <= n; i++) flag &= (dsu.find(i) == dsu.find(1));
    if (!flag) { cout << "No\n"; return 0; }
    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= n; j++) reach[j] = false;
        search(i);
        for (int j = 1; j <= n; j++)
            if (reach[j] != e[i][j]) { cout << "No\n"; return 0; }
    }
    cout << "Yes\n";
    for (int i = 0; i < (int)edges.size(); i++)
        cout << edges[i].first << ' ' << edges[i].second << '\n';
    return 0;
}'''

H = '#include <iostream>\n#include <vector>\nusing namespace std;\n'

# Sentinel expectations. A case whose `expected` is one of these asserts on the
# KIND of outcome rather than on stdout — for several of these fixes the whole
# point is that the program must STOP instead of quietly producing a number.
CRASHED = '<crash>'      # tracer reported a runtime crash (e.g. at() out of range)
REFUSED = '<refused>'    # tracer refused the program up front (the P2 raise path)

CASES = [
    # ── vector::assign — was undeclared in _STUBS, so libclang never even
    #    formed a member call; the vector silently stayed empty. ──────────
    ("assign-nested", "outer=3 inner=0\n",
     H + 'int main(){ vector<vector<int>> t; t.assign(3, vector<int>());\n'
         '  cout<<"outer="<<t.size()<<" inner="<<t[1].size()<<"\\n"; }'),
    ("assign-then-pushback", "size=2 v0=7\n",
     H + 'int main(){ vector<vector<int>> t; t.assign(3, vector<int>());\n'
         '  t[1].push_back(7); t[1].push_back(9);\n'
         '  cout<<"size="<<t[1].size()<<" v0="<<t[1][0]<<"\\n"; }'),
    ("assign-scalar", "n=4 v2=5\n",
     H + 'int main(){ vector<int> a; a.assign(4, 5);\n'
         '  cout<<"n="<<a.size()<<" v2="<<a[2]<<"\\n"; }'),
    ("assign-shrinks", "n=2\n",
     H + 'int main(){ vector<int> a(9, 1); a.assign(2, 3); cout<<"n="<<a.size()<<"\\n"; }'),
    # assign(n, container) must hand out n INDEPENDENT copies: if the slots
    # shared one object, pushing into t[1] would show up in t[0] and t[2].
    ("assign-no-aliasing", "0 1 0\n",
     H + 'int main(){ vector<vector<int>> t; t.assign(3, vector<int>());\n'
         '  t[1].push_back(7);\n'
         '  cout<<t[0].size()<<" "<<t[1].size()<<" "<<t[2].size()<<"\\n"; }'),
    ("assign-nonempty-proto", "2 3 9\n",
     H + 'int main(){ vector<vector<int>> u; u.assign(2, vector<int>(2, 9));\n'
         '  u[0].push_back(5);\n'
         '  cout<<u[1].size()<<" "<<u[0].size()<<" "<<u[1][1]<<"\\n"; }'),

    # ── `struct X { ... } obj;` — the inline instance declarator was created
    #    as a plain int 0, so reads returned 0 and writes were dropped. ────
    ("inline-global-scalar", "x=42\n",
     H + 'struct S { int x; } g;\n'
         'int main(){ g.x = 42; cout<<"x="<<g.x<<"\\n"; }'),
    ("inline-global-array", "a3=42\n",
     H + 'struct S { int a[10]; } g;\n'
         'int main(){ g.a[3] = 42; cout<<"a3="<<g.a[3]<<"\\n"; }'),
    ("inline-global-method", "x=42\n",
     H + 'struct S { int x; void w(){ x = 42; } } g;\n'
         'int main(){ g.w(); cout<<"x="<<g.x<<"\\n"; }'),
    ("inline-multiple-declarators", "1 2\n",
     H + 'struct T { int y; } a, b;\n'
         'int main(){ a.y = 1; b.y = 2; cout<<a.y<<" "<<b.y<<"\\n"; }'),
    ("inline-def-no-declarator", "ok\n",
     H + 'struct U { int z; };\nint main(){ cout<<"ok\\n"; }'),
    ("inline-local-instance", "y=7\n",
     H + 'int main(){ struct P { int y; } p; p.y = 7; cout<<"y="<<p.y<<"\\n"; }'),
    # merge(x,y) is `fa[find(x)]=find(y)`, so 1 reparents onto 2 and 2 onto 3,
    # leaving 3 the root of all three. Verified with g++ — NOT "1 1 1".
    ("inline-global-dsu", "find=3 3 3\n",
     H + 'struct Dsu {\n'
         '  int fa[100];\n'
         '  void init(int n){ for(int i=1;i<=n;i++) fa[i]=i; }\n'
         '  int find(int x){ if(x==fa[x]) return x; return fa[x]=find(fa[x]); }\n'
         '  void merge(int x,int y){ fa[find(x)]=find(y); }\n'
         '} dsu;\n'
         'int main(){ dsu.init(3); dsu.merge(1,2); dsu.merge(2,3);\n'
         '  cout<<"find="<<dsu.find(1)<<" "<<dsu.find(2)<<" "<<dsu.find(3)<<"\\n"; }'),

    # ── Regressions: these always worked and must keep working ───────────
    ("separate-decl-still-ok", "x=42\n",
     H + 'struct S { int x; };\nS g;\n'
         'int main(){ g.x = 42; cout<<"x="<<g.x<<"\\n"; }'),
    ("global-plain-array-still-ok", "a3=42\n",
     H + 'int arr[10];\nint main(){ arr[3] = 42; cout<<"a3="<<arr[3]<<"\\n"; }'),
    ("ctor-sized-nested-still-ok", "size=1\n",
     H + 'int main(){ vector<vector<int>> t(3); t[1].push_back(7);\n'
         '  cout<<"size="<<t[1].size()<<"\\n"; }'),

    # ── _default_for_type matched primitive type names as SUBSTRINGS before it
    #    consulted class_defs, so every struct whose lowercased name contains
    #    "int"/"long"/"bool"/"char"/… defaulted to int 0. `Point` is the obvious
    #    casualty. The nested WRITE was a second, independent silent drop: the
    #    base of `b.p.x` is itself a member access, so its flattened name 'b.p'
    #    was not a variable and the assignment fell down an `except: pass`.
    ("struct-name-contains-primitive", "x=5\n",
     H + 'struct Point { int x; int y; };\n'
         'struct Box { Point p; };\n'
         'int main(){ Box b; b.p.x = 5; cout<<"x="<<b.p.x<<"\\n"; }'),
    ("nested-struct-write-three-deep", "7\n",
     H + 'struct A { int v; };\nstruct B { A a; };\nstruct C { B b; };\n'
         'int main(){ C c; c.b.a.v = 7; cout<<c.b.a.v<<"\\n"; }'),
    ("nested-struct-defaults-zero", "0 0\n",
     H + 'struct Point { int x; int y; };\nstruct Box { Point p; int w; };\n'
         'int main(){ Box b; cout<<b.p.x<<" "<<b.p.y<<"\\n"; }'),

    # ── vector::emplace_back — undeclared in _STUBS AND unhandled, so it was a
    #    pure no-op: the append vanished with no error. Very common in
    #    competitive code, which made it the highest-impact silent bug. ──────
    ("emplace-back", "n=2 v0=5\n",
     H + 'int main(){ vector<int> a; a.emplace_back(5); a.emplace_back(9);\n'
         '  cout<<"n="<<a.size()<<" v0="<<a[0]<<"\\n"; }'),
    ("emplace-back-pair", "1 2\n",
     '#include <iostream>\n#include <vector>\n#include <utility>\nusing namespace std;\n'
     'int main(){ vector<pair<int,int>> v; v.emplace_back(1,2);\n'
     '  cout<<v[0].first<<" "<<v[0].second<<"\\n"; }'),
    ("emplace-back-struct", "3 4\n",
     H + 'struct P { int x,y; P(int a,int b):x(a),y(b){} };\n'
         'int main(){ vector<P> v; v.emplace_back(3,4);\n'
         '  cout<<v[0].x<<" "<<v[0].y<<"\\n"; }'),
    ("emplace-back-nested", "1 7\n",
     H + 'int main(){ vector<vector<int>> g(2); g[0].emplace_back(7);\n'
         '  cout<<g[0].size()<<" "<<g[0][0]<<"\\n"; }'),

    # ── vector::at — returned 0 for every index and never threw. ──────────
    ("vector-at", "v=7\n",
     H + 'int main(){ vector<int> a{3,7,9}; cout<<"v="<<a.at(1)<<"\\n"; }'),
    ("vector-at-throws", CRASHED,
     H + 'int main(){ vector<int> a{1,2}; cout<<"before\\n"; cout<<a.at(5)<<"\\n"; }'),

    # ── erase/insert/swap shift or replace contents. As no-ops they left every
    #    later index off by one, which reads as a plausible wrong answer. ────
    ("vector-erase-one", "4: 1 3 4 5 \n",
     H + 'int main(){ vector<int> v{1,2,3,4,5}; v.erase(v.begin()+1);\n'
         '  cout<<v.size()<<": "; for(int x:v) cout<<x<<" "; cout<<"\\n"; }'),
    ("vector-erase-range", "2: 1 5 \n",
     H + 'int main(){ vector<int> v{1,2,3,4,5}; v.erase(v.begin()+1, v.begin()+4);\n'
         '  cout<<v.size()<<": "; for(int x:v) cout<<x<<" "; cout<<"\\n"; }'),
    ("vector-insert", "4: 1 2 99 3 \n",
     H + 'int main(){ vector<int> v{1,2,3}; v.insert(v.begin()+2, 99);\n'
         '  cout<<v.size()<<": "; for(int x:v) cout<<x<<" "; cout<<"\\n"; }'),
    ("vector-insert-front", "3: 7 1 2 \n",
     H + 'int main(){ vector<int> v{1,2}; v.insert(v.begin(), 7);\n'
         '  cout<<v.size()<<": "; for(int x:v) cout<<x<<" "; cout<<"\\n"; }'),
    ("vector-swap", "1 2 | 9 | 1 2 \n",
     H + 'int main(){ vector<int> a{1,2}, b{9}; a.swap(b);\n'
         '  cout<<a.size()<<" "<<b.size()<<" | "<<a[0]<<" | "<<b[0]<<" "<<b[1]<<" \\n"; }'),
    # capacity is only as real as the growth model behind it. These values are
    # libstdc++'s, verified with g++: geometric doubling FROM WHAT THE VECTOR HAD,
    # so a list-initialised vector reports capacity == size until the first push.
    ("vector-capacity-growth", "5 8\n",
     H + 'int main(){ vector<int> v; for(int i=0;i<5;i++) v.push_back(i);\n'
         '  cout<<v.size()<<" "<<v.capacity()<<"\\n"; }'),
    ("vector-capacity-listinit", "3 3\n",
     H + 'int main(){ vector<int> v{1,2,3}; cout<<v.size()<<" "<<v.capacity()<<"\\n"; }'),
    ("vector-capacity-after-push", "4 6\n",
     H + 'int main(){ vector<int> v{1,2,3}; v.push_back(4);\n'
         '  cout<<v.size()<<" "<<v.capacity()<<"\\n"; }'),
    ("vector-reserve-shrink", "20 4\n",
     H + 'int main(){ vector<int> v{1,2,3}; v.push_back(4); v.reserve(20);\n'
         '  cout<<v.capacity()<<" "; v.shrink_to_fit(); cout<<v.capacity()<<"\\n"; }'),

    # ── deque<int> d{1,2,3} dropped its initialiser list: the container was built
    #    empty and every later read was quietly wrong. ─────────────────────
    ("deque-init-list", "3 1 3\n",
     '#include <iostream>\n#include <deque>\nusing namespace std;\n'
     'int main(){ deque<int> d{1,2,3}; cout<<d.size()<<" "<<d.at(0)<<" "<<d[2]<<"\\n"; }'),

    # ── c_str()/data() hand out a C string, which ENDS at the first NUL; resize
    #    pads with NULs that must not be printed. ──────────────────────────
    ("c_str-stops-at-nul", "5abc\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'int main(){ string s="abc"; s.resize(5); cout<<s.size()<<s.data()<<"\\n"; }'),

    # ── map::emplace was worse than a no-op: the token fallback routed it to the
    #    queue/stack handler, which appended a pair to a 'values' list, so a later
    #    m[k] read back as the PAIR. set::emplace was a plain no-op. ──────────
    ("map-emplace", "2 100 200\n",
     '#include <iostream>\n#include <map>\nusing namespace std;\n'
     'int main(){ map<int,int> m; m.emplace(1,100); m.emplace(2,200);\n'
     '  cout<<m.size()<<" "<<m[1]<<" "<<m[2]<<"\\n"; }'),
    ("set-emplace", "2 1 0\n",
     '#include <iostream>\n#include <set>\nusing namespace std;\n'
     'int main(){ set<int> s; s.emplace(5); s.emplace(7); s.emplace(5);\n'
     '  cout<<s.size()<<" "<<s.count(5)<<" "<<s.count(6)<<"\\n"; }'),
    # A set of pairs keys on the WHOLE pair; splitting on .first collapsed these.
    ("set-of-pairs-distinct-firsts", "2\n",
     '#include <iostream>\n#include <set>\n#include <utility>\nusing namespace std;\n'
     'int main(){ set<pair<int,int>> s; s.insert({1,2}); s.insert({1,3});\n'
     '  cout<<s.size()<<"\\n"; }'),
    # ── set(first, last) — the iterator-range ctor yielded an EMPTY set. ────
    ("set-range-ctor", "3 | 1 2 3 \n",
     '#include <iostream>\n#include <vector>\n#include <set>\nusing namespace std;\n'
     'int main(){ vector<int> a{3,1,3,2}; set<int> s(a.begin(), a.end());\n'
     '  cout<<s.size()<<" | "; for(int x:s) cout<<x<<" "; cout<<"\\n"; }'),

    # ── map<K, vector<V>>: .size() through m[k] worked, so writes landed, but
    #    the indexed READ m[k][i] always returned 0. ───────────────────────
    ("map-of-vector-indexed-read", "2 1 | 10 20 30\n",
     '#include <iostream>\n#include <map>\n#include <vector>\nusing namespace std;\n'
     'int main(){ map<int, vector<int>> m;\n'
     '  m[1].push_back(10); m[1].push_back(20); m[2].push_back(30);\n'
     '  cout<<m[1].size()<<" "<<m[2].size()<<" | "\n'
     '      <<m[1][0]<<" "<<m[1][1]<<" "<<m[2][0]<<"\\n"; }'),

    # ── deque::at returned 0; deque::size() in a size_t loop never terminated. ──
    ("deque-at", "4 5 6\n",
     '#include <iostream>\n#include <deque>\nusing namespace std;\n'
     'int main(){ deque<int> d; d.push_back(5); d.push_back(6); d.push_front(4);\n'
     '  cout<<d.at(0)<<" "<<d.at(1)<<" "<<d.at(2)<<"\\n"; }'),
    ("deque-size-loop-terminates", "1 2 3 \n",
     '#include <iostream>\n#include <deque>\nusing namespace std;\n'
     'int main(){ deque<int> d; d.push_back(1); d.push_back(2); d.push_back(3);\n'
     '  for (size_t i = 0; i < d.size(); i++) cout<<d[i]<<" "; cout<<"\\n"; }'),
    # Not a deque bug at all: `size_t` was undeclared, so the loop variable never
    # existed, read as 0 forever and spun to the step limit — for ANY container.
    ("size_t-loop-vector", "1 2 3 \n",
     H + 'int main(){ vector<int> v{1,2,3};\n'
         '  for (size_t i = 0; i < v.size(); i++) cout<<v[i]<<" "; cout<<"\\n"; }'),
    ("size_t-plain-variable", "7\n",
     H + 'int main(){ size_t n = 7; cout<<n<<"\\n"; }'),

    # ── Constructor overloads were never selected: every site took ctors[0], so a
    #    class declaring its default ctor first ran THAT for Point(1,1) and threw
    #    the arguments away. The object came back all zeros, with no error. ────
    ("ctor-overload-by-arity", "3 4\n",
     H + 'struct P { int x,y; P(){x=0;y=0;} P(int a,int b):x(a),y(b){} };\n'
         'int main(){ P p(3,4); cout<<p.x<<" "<<p.y<<"\\n"; }'),
    ("ctor-overload-default-still-ok", "0 0\n",
     H + 'struct P { int x,y; P(){x=0;y=0;} P(int a,int b):x(a),y(b){} };\n'
         'int main(){ P p; cout<<p.x<<" "<<p.y<<"\\n"; }'),
    ("ctor-overload-emplace-back", "3 4\n",
     H + 'struct P { int x,y; P(){x=0;y=0;} P(int a,int b):x(a),y(b){} };\n'
         'int main(){ vector<P> v; v.emplace_back(3,4);\n'
         '  cout<<v[0].x<<" "<<v[0].y<<"\\n"; }'),
    # Assigning a temporary into a nested member field.
    ("ctor-overload-nested-assign", "12\n",
     H + 'struct Pt { int x,y; Pt(){x=0;y=0;} Pt(int a,int b):x(a),y(b){} };\n'
         'struct Rect { Pt tl, br; int area(){ return (br.x-tl.x)*(br.y-tl.y); } };\n'
         'int main(){ Rect r; r.tl=Pt(1,1); r.br=Pt(4,5); cout<<r.area()<<"\\n"; }'),

    # ── `string w[] = {...}` is an array of TEXT, but only char arrays were
    #    treated as such — every element went through _to_int and read back as
    #    the first character's CODE (w[0] == 97, not "ab"). ─────────────────
    ("string-array-elements", "ab cd\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'int main(){ string w[] = {"ab","cd"}; cout<<w[0]<<" "<<w[1]<<"\\n"; }'),
    # ── P2: an unrecognised container method must REFUSE, not return 0. The
    #    frontend turns any error into a banner plus "Convert for DryRun", so a
    #    refusal routes the user to a remedy; _INT(0) routed them to a confident
    #    wrong answer. Implemented methods must of course keep working. ──────
    ("p2-refuse-unknown-vector-method", REFUSED,
     H + 'int main(){ vector<int> v{1,2,3}; cout<<v.frobnicate(1)<<"\\n"; }'),
    ("p2-refuse-vector-data", REFUSED,
     H + 'int main(){ vector<int> v{1,2,3}; cout<<*v.data()<<"\\n"; }'),
    ("p2-refuse-unknown-map-method", REFUSED,
     '#include <iostream>\n#include <map>\nusing namespace std;\n'
     'int main(){ map<int,int> m; m[1]=2; cout<<m.frobnicate()<<"\\n"; }'),
    ("p2-refuse-unknown-string-method", REFUSED,
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'int main(){ string s="ab"; cout<<s.frobnicate()<<"\\n"; }'),
    # map::at does not insert — it throws. Returning 0 was the exact wrongness
    # a program picks at() to avoid.
    ("map-at-missing-key-throws", CRASHED,
     '#include <iostream>\n#include <map>\nusing namespace std;\n'
     'int main(){ map<int,int> m; m[1]=5; cout<<"before\\n"; cout<<m.at(9)<<"\\n"; }'),
    ("map-at-present-key", "5\n",
     '#include <iostream>\n#include <map>\nusing namespace std;\n'
     'int main(){ map<int,int> m; m[1]=5; cout<<m.at(1)<<"\\n"; }'),
    # *s.rbegin() is the idiomatic largest-element read on a sorted set.
    ("set-rbegin", "9 1\n",
     '#include <iostream>\n#include <set>\nusing namespace std;\n'
     'int main(){ set<int> s; s.insert(1); s.insert(9); s.insert(4);\n'
     '  cout<<*s.rbegin()<<" "<<*s.begin()<<"\\n"; }'),
    ("vector-emplace-at-pos", "1 99 2 \n",
     H + 'int main(){ vector<int> v{1,2}; v.emplace(v.begin()+1, 99);\n'
         '  for(int x:v) cout<<x<<" "; cout<<"\\n"; }'),

    # ── `string t;` (no initialiser) hangs a CHILDLESS CALL_EXPR 'string' off the
    #    declarator, and _eval_call bailed out of those with int 0. So t was a
    #    number: `t += 'a'` did arithmetic and the string printed as "0". Building
    #    a string char-by-char in a loop is about as common as C++ gets. ──────
    ("default-string-plus-eq-char", "[abc]\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'int main(){ string s="abc", t; for(char c:s) t+=c; cout<<"["<<t<<"]\\n"; }'),
    ("default-string-plus-eq-str", "[ab]\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'int main(){ string t; t += "ab"; cout<<"["<<t<<"]\\n"; }'),
    ("default-string-empty", "[] 1\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'int main(){ string t; cout<<"["<<t<<"] "<<t.empty()<<"\\n"; }'),

    # ── A CONST member returning a field spells the copy-construction with the
    #    MEMBER_REF_EXPR as the direct child (the non-const form wraps it), so the
    #    dispatcher read the FIELD name as a method: const getters returning a
    #    string handed back 0. Ints were unaffected, which hid it. ───────────
    ("const-getter-returns-string", "[hi]\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'struct B{ string n; B(string x):n(x){} string g() const {return n;} };\n'
     'int main(){ B b("hi"); cout<<"["<<b.g()<<"]\\n"; }'),
    ("const-getter-inherited", "circle\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'class Shape{ protected: string name; public: Shape(string n):name(n){}\n'
     '  string getName() const { return name; } };\n'
     'class Circle: public Shape{ public: Circle():Shape("circle"){} };\n'
     'int main(){ Circle c; cout<<c.getName()<<"\\n"; }'),
    ("nonconst-getter-still-ok", "[hi]\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'struct B{ string n; B(string x):n(x){} string g() {return n;} };\n'
     'int main(){ B b("hi"); cout<<"["<<b.g()<<"]\\n"; }'),

    # ── BUG A: vector<string> elements read back as the first CHARACTER CODE.
    #    _arr_push (and every sibling coercion) preserved only 'struct'/'array',
    #    so a std::string value collapsed to _to_int → 112 for "pen". Plain
    #    vector<string> is bread-and-butter C++. ────────────────────────────
    ("vecstring-element-read", "pen|3|1\n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'int main(){ vector<string> v; v.push_back("pen");\n'
     '  cout<<v[0]<<"|"<<v[0].size()<<"|"<<v.size()<<"\\n"; }'),
    ("vecstring-index-loop", "pen,book,\n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'int main(){ vector<string> v; v.push_back("pen"); v.push_back("book");\n'
     '  string o; for(size_t i=0;i<v.size();i++) o += v[i] + ",";\n'
     '  cout<<o<<"\\n"; }'),
    # A reference range-for writes the loop variable BACK into the container.
    ("vecstring-ref-rangefor-writeback", "pen book \n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'int main(){ vector<string> v{"pen","book"};\n'
     '  for(const string &s : v) { (void)s; }\n'
     '  for(size_t i=0;i<v.size();i++) cout<<v[i]<<" "; cout<<"\\n"; }'),
    ("vecstring-fill-and-assign", "3 zz | 2 q | 4 []\n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'int main(){ vector<string> v(3,"zz"); cout<<v.size()<<" "<<v[0]<<" | ";\n'
     '  v.assign(2,"q"); cout<<v.size()<<" "<<v[1]<<" | ";\n'
     '  v.resize(4); cout<<v.size()<<" ["<<v[3]<<"]\\n"; }'),
    # vector<int> must still take a char as its CODE — the element type decides.
    ("vecint-char-still-numeric", "97 5 | ab\n",
     '#include <iostream>\n#include <vector>\nusing namespace std;\n'
     'int main(){ vector<int> n; n.push_back(\'a\'); n.push_back(5);\n'
     '  cout<<n[0]<<" "<<n[1]<<" | ";\n'
     '  vector<char> c; c.push_back(\'a\'); c.push_back(\'b\');\n'
     '  cout<<c[0]<<c[1]<<"\\n"; }'),
    ("vecstring-nested-and-charindex", "hi 2 p\n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'int main(){ vector<vector<string>> g(1); g[0].push_back("hi");\n'
     '  vector<string> v{"pen"};\n'
     '  cout<<g[0][0]<<" "<<g[0][0].size()<<" "<<v[0][0]<<"\\n"; }'),
    ("vecstring-subscript-append", "hi! 3\n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'int main(){ vector<string> v(1); v[0]="hi"; v[0]+="!";\n'
     '  cout<<v[0]<<" "<<v[0].size()<<"\\n"; }'),
    # set<string> kept INSERTION order: every non-numeric key tied in the sort key.
    ("set-of-strings-sorted", "2 a\n",
     '#include <iostream>\n#include <string>\n#include <set>\nusing namespace std;\n'
     'int main(){ set<string> s; s.insert("b"); s.insert("a"); s.insert("b");\n'
     '  cout<<s.size()<<" "<<*s.begin()<<"\\n"; }'),

    # ── BUGS B & C: a braced aggregate initialiser never became a struct.
    #    libclang stamps the TARGET class on the init-list cursor, so both the
    #    untyped `{...}` argument and the explicit `Item{...}` temporary degraded
    #    to a bare array and EVERY field read came back 0. ──────────────────
    ("aggregate-push-back-braces", "pen 3\n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'struct Item { string name; int qty; };\n'
     'int main(){ vector<Item> v; v.push_back({"pen",3});\n'
     '  cout<<v[0].name<<" "<<v[0].qty<<"\\n"; }'),
    ("aggregate-emplace-back-temporary", "book 5\n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'struct Item { string name; int qty; };\n'
     'int main(){ vector<Item> v; v.emplace_back(Item{"book",5});\n'
     '  cout<<v[0].name<<" "<<v[0].qty<<"\\n"; }'),
    ("aggregate-nested-braces", "1 2 7\n",
     H + 'struct Point { int x, y; };\nstruct Box { Point tl; int w; };\n'
         'int main(){ Box b{{1,2},7}; cout<<b.tl.x<<" "<<b.tl.y<<" "<<b.w<<"\\n"; }'),
    # A string reached through a subscript or member has no variable NAME, so the
    # string dispatcher resolved nothing and answered as if it were empty.
    ("string-field-of-vector-element", "3 a\n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'struct S { string name; int n; };\n'
     'int main(){ vector<S> v; v.push_back({"ann",1});\n'
     '  cout<<v[0].name.size()<<" "<<v[0].name[0]<<"\\n"; }'),
    ("string-field-mutation-persists", "ann!? 5 42\n",
     '#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n'
     'struct S { string name; int n; };\n'
     'int main(){ vector<S> v; v.push_back({"ann",1});\n'
     '  v[0].name.push_back(\'!\'); v[0].n = 42; v[0].name += "?";\n'
     '  cout<<v[0].name<<" "<<v[0].name.size()<<" "<<v[0].n<<"\\n"; }'),
    # `x.f += v` puts the MEMBER REF in the callee slot, where it IS the lvalue;
    # descending into it grabbed the owning struct and the append was discarded.
    ("member-plus-eq-on-plain-struct", "ab 2\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'struct S { string t; };\n'
     'int main(){ S s; s.t = "a"; s.t += "b"; cout<<s.t<<" "<<s.t.size()<<"\\n"; }'),

    ("aggregate-plain-decl-still-ok", "cap 9\n",
     '#include <iostream>\n#include <string>\nusing namespace std;\n'
     'struct Item { string name; int qty; };\n'
     'int main(){ Item a = {"cap",9}; cout<<a.name<<" "<<a.qty<<"\\n"; }'),

    ("string-array-as-map-key", "a=3 b=2 c=1 \n",
     '#include <iostream>\n#include <map>\n#include <string>\nusing namespace std;\n'
     'int main(){ map<string,int> f; string w[]={"a","b","a","c","b","a"};\n'
     '  for(int i=0;i<6;i++) f[w[i]]++;\n'
     '  for(auto &p : f) cout<<p.first<<"="<<p.second<<" "; cout<<"\\n"; }'),
]

FULL_STDIN    = "4\n1000\n1111\n1010\n0001\n"
FULL_EXPECTED = "Yes\n2 3\n2 4\n3 1\n"

# Cases known to fail until the container-method work lands; reported
# separately so a red line here doesn't look like a fresh regression.
KNOWN_UNFIXED = set()


def run(src, stdin=''):
    req = urllib.request.Request(
        URL,
        data=json.dumps({'source': src, 'language': 'cpp', 'stdin_input': stdin}).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=300).read())
    except urllib.error.HTTPError as ex:
        # A refusal is a RESULT, not a transport failure: some cases assert that
        # the tracer declines the program rather than inventing a number for it.
        # The detail rides along in `err` purely so failures print something useful.
        return REFUSED, f'HTTP {ex.code}: {ex.read().decode()[:300]}'
    except Exception as ex:
        return None, str(ex)[:200]
    tr = r['trace']
    steps = tr['steps'] if isinstance(tr, dict) else tr
    out = ''.join(s['event'].get('text', '')
                  for s in steps if s.get('event', {}).get('type') == 'output')
    if any(s.get('event', {}).get('type') == 'crash' for s in steps):
        return CRASHED, None
    return out, None


def main():
    fixed_fail, known_fail = [], []

    for name, expected, src in CASES + [('FULL-PROGRAM', FULL_EXPECTED, TREE_RECONSTRUCT)]:
        stdin = FULL_STDIN if name == 'FULL-PROGRAM' else ''
        got, err = run(src, stdin)
        # A refusal only counts as an error when the case did not ask for one.
        ok = got == expected and (not err or expected == REFUSED)
        tag = 'PASS' if ok else ('known' if name in KNOWN_UNFIXED else 'FAIL')
        print(f'  {tag:5} {name}')
        if not ok:
            print(f'        expected {expected!r}\n        got      {got!r}{" " + err if err else ""}')
            (known_fail if name in KNOWN_UNFIXED else fixed_fail).append(name)

    total = len(CASES) + 1
    print(f'\n  {total - len(fixed_fail) - len(known_fail)}/{total - len(known_fail)} '
          f'must-pass cases green')
    if known_fail:
        print(f'  {len(known_fail)} known-unfixed still failing: {", ".join(known_fail)}')
    if fixed_fail:
        print(f'  REGRESSION: {", ".join(fixed_fail)}')
    return 1 if fixed_fail else 0


if __name__ == '__main__':
    sys.exit(main())
