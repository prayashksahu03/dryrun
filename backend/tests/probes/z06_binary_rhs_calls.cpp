// Side effects in a binary RHS must run EXACTLY once. The tracer built a causal
// chain for `x = a op b` by re-evaluating both operands, so every call in the
// RHS fired twice; the arithmetic still came out right, so only a counter,
// a push_back inside a helper, or a memo write ever revealed it.
#include <iostream>
#include <vector>
using namespace std;

int calls = 0;
vector<int> log_;

int f(int x) { calls++; log_.push_back(x); return x; }

int main() {
    int s = f(1) + f(2);
    cout << s << " " << calls << " " << log_.size() << "\n";

    calls = 0;
    int t;
    t = f(3) * f(4) - f(5);
    cout << t << " " << calls << "\n";

    calls = 0;
    vector<int> v(2);
    v[0] = f(6) + f(7);
    v[1] = f(8) % f(3);
    cout << v[0] << " " << v[1] << " " << calls << "\n";

    calls = 0;
    int a = f(9);
    cout << a << " " << calls << "\n";

    calls = 0;
    cout << f(10) + f(11) << " " << calls << "\n";

    for (size_t i = 0; i < log_.size(); i++) cout << log_[i] << " ";
    cout << "\n";

    // Naming the cell for a READ node re-derives the INDEX, so a side-effecting
    // subscript doubled by the same mechanism.
    vector<int> tab = {10, 20, 30};
    int k = 0;
    int si = tab[k++] + 5;
    cout << si << " " << k << "\n";

    // The plain-arithmetic chain the feature exists for must survive.
    int p = 5, q = 4;
    int sum = p + q, diff = p - q, prod = p * q;
    cout << sum << " " << diff << " " << prod << "\n";
    return 0;
}
