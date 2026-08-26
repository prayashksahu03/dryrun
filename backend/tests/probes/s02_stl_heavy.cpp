#include <iostream>
#include <vector>
#include <map>
#include <set>
#include <algorithm>
#include <string>
using namespace std;
int main(){
    vector<int> v{5,3,9,1,7};
    sort(v.begin(), v.end());
    for (int x : v) cout << x << " ";
    cout << "\n";
    reverse(v.begin(), v.end());
    for (size_t i = 0; i < v.size(); i++) cout << v[i] << " ";
    cout << "\n";
    map<string,int> freq;
    string words[] = {"a","b","a","c","b","a"};
    for (int i = 0; i < 6; i++) freq[words[i]]++;
    for (auto &p : freq) cout << p.first << "=" << p.second << " ";
    cout << "\n";
    set<int> s(v.begin(), v.end());
    cout << s.size() << " " << *s.begin() << "\n";
    cout << *max_element(v.begin(), v.end()) << " " << *min_element(v.begin(), v.end()) << "\n";
    return 0;
}
