#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    vector<string> v;
    v.push_back("pen"); v.emplace_back("book"); v.push_back("ink");
    cout << v.size() << " " << v[0] << " " << v.at(1) << " " << v.back() << " " << v.front() << "\n";
    for (size_t i=0;i<v.size();i++) cout << v[i] << ":" << v[i].size() << " ";
    cout << "\n";
    sort(v.begin(), v.end());
    for (const string &s : v) cout << s << " ";
    cout << "\n";
    v.erase(v.begin());
    v.insert(v.begin(), "aaa");
    for (size_t i=0;i<v.size();i++) cout << v[i] << " ";
    cout << "\n";
    cout << v[0].substr(0,2) << " " << v[1].empty() << " " << v[2][0] << "\n";
    return 0;
}
