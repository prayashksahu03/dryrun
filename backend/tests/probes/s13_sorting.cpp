#include <iostream>
#include <vector>
#include <algorithm>
#include <utility>
#include <numeric>
using namespace std;
int main(){
    vector<pair<int,int>> v;
    v.emplace_back(3,1); v.emplace_back(1,2); v.emplace_back(2,3);
    sort(v.begin(), v.end());
    for (auto &p : v) cout << p.first << "," << p.second << " ";
    cout << "\n";
    vector<int> a{4,2,8,6};
    sort(a.begin(), a.end(), [](int x,int y){ return x>y; });
    for (int x : a) cout << x << " ";
    cout << "\n";
    cout << binary_search(a.begin(), a.end(), 6) << "\n";
    reverse(a.begin(), a.end());
    cout << (lower_bound(a.begin(), a.end(), 6) - a.begin()) << "\n";
    int total = accumulate(a.begin(), a.end(), 0);
    cout << total << "\n";
    return 0;
}
