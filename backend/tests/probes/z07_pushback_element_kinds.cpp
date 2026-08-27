// push_back coerced its argument to an int unless it was a struct, array or
// char, so every other element kind was silently flattened: a vector<Node*>
// stored 1 per non-null pointer, a vector<map<>> stored the map's size. Indexed
// writes into a pre-sized vector took another path and stayed correct, which is
// why only push_back — the BFS idiom — broke.
#include <iostream>
#include <vector>
#include <deque>
#include <string>
using namespace std;

struct Node { int val; Node* l; Node* r; };

int main() {
    Node c{2, 0, 0}, d{3, 0, 0}, a{1, &c, &d};

    vector<Node*> q;
    q.push_back(&a);
    for (size_t i = 0; i < q.size(); i++) {
        Node* n = q[i];
        cout << n->val << " ";
        if (n->l) q.push_back(n->l);
        if (n->r) q.push_back(n->r);
    }
    cout << "| " << q.size() << "\n";

    Node* p = &c;
    vector<Node*> e;
    e.emplace_back(p);
    e.emplace_back(&d);
    cout << e[0]->val << " " << e[1]->val << "\n";

    // NOTE: &arr[i] deliberately avoided — taking the address of an ARRAY ELEMENT
    // is a separate, still-open gap (it yields a null pointer), unrelated to how
    // push_back stores what it is handed.
    int x = 4, y = 6;
    vector<int*> pi;
    pi.push_back(&x);
    pi.push_back(&y);
    cout << *pi[0] << " " << *pi[1] << "\n";

    // vector<map<>> / vector<set<>> are NOT probed here: push_back stores them
    // intact now, but reading one back (`vm[0].size()`) is a separate, still-open
    // gap — see KNOWN_UNFIXED in tests/regressions.py.

    // Kinds that already worked must keep working.
    vector<string> names; names.push_back("ann");
    vector<char> ch; ch.push_back('z');
    vector<vector<int>> g; g.push_back({1, 2}); g.push_back({3});
    vector<int> ints; ints.push_back(41); ints.push_back(42);
    cout << names[0] << " " << ch[0] << " " << g[0][1] << " " << g[1].size()
         << " " << ints[0] << " " << ints[1] << "\n";

    // Pre-sized vector + indexed write: the path that was always right.
    vector<Node*> q3(1);
    q3[0] = &d;
    q3.push_back(&c);
    cout << q3[0]->val << " " << q3[1]->val << "\n";

    // The same allow-list had been copied to four other stores, so the SAME value
    // survived push_back and was flattened by push_front, assign or resize.
    deque<Node*> dq;
    dq.push_back(&c);
    dq.push_front(&d);
    cout << dq[0]->val << " " << dq[1]->val << "\n";

    vector<Node*> fa;
    fa.assign(2, &c);
    vector<Node*> fr;
    fr.resize(2, &d);
    cout << fa[0]->val << " " << fa[1]->val << " "
         << fr[0]->val << " " << fr[1]->val << "\n";

    // Range-for write-back through a reference must not flatten either.
    vector<Node*> rf(2);
    for (Node*& n : rf) n = &c;
    cout << rf[0]->val << " " << rf[1]->val << "\n";
    return 0;
}
