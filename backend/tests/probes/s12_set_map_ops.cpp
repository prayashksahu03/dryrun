#include <iostream>
#include <set>
#include <map>
#include <vector>
using namespace std;
int main(){
    set<int> s;
    for (int x : {5,1,9,1,3}) s.insert(x);
    cout << s.size() << " " << *s.begin() << " " << *s.rbegin() << "\n";
    cout << s.count(9) << s.count(100) << "\n";
    s.erase(9);
    for (int x : s) cout << x << " ";
    cout << "\n";
    map<int,int> m;
    m[3] = 30; m[1] = 10; m.emplace(2, 20);
    for (auto &p : m) cout << p.first << ":" << p.second << " ";
    cout << "\n";
    cout << m.count(1) << " " << m.at(2) << " " << m.size() << "\n";
    m.erase(1);
    cout << m.size() << "\n";
    map<int, vector<int>> g;
    g[1].push_back(7); g[1].push_back(8);
    cout << g[1].size() << " " << g[1][0] << " " << g[1][1] << "\n";
    return 0;
}
