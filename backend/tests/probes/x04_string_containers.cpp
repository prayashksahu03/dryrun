#include <iostream>
#include <string>
#include <vector>
#include <map>
#include <set>
#include <queue>
using namespace std;
int main(){
    set<string> s; s.insert("b"); s.insert("a"); s.insert("b");
    cout << s.size() << " " << *s.begin() << "\n";
    map<string, vector<string>> m;
    m["fruit"].push_back("apple");
    m["fruit"].push_back("pear");
    cout << m["fruit"].size() << " " << m["fruit"][0] << " " << m["fruit"][1] << "\n";
    queue<string> q; q.push("x"); q.push("y");
    cout << q.front() << q.back() << q.size() << "\n";
    vector<vector<string>> g(2);
    g[0].push_back("hi"); g[1].emplace_back("yo");
    cout << g[0][0] << g[1][0] << " " << g[0][0].size() << "\n";
    string w[2] = {"ab","cd"};
    cout << w[0] << w[1] << " " << w[0].size() << "\n";
    return 0;
}
