#include <iostream>
#include <string>
#include <vector>
#include <map>
#include <algorithm>
using namespace std;
int main(){
    vector<string> words{"the","cat","the","dog","cat","the"};
    map<string,int> freq;
    for (const string &w : words) freq[w]++;
    for (auto &p : freq) cout << p.first << ":" << p.second << " ";
    cout << "\n";
    vector<pair<string,int>> v;
    for (auto &p : freq) v.emplace_back(p.first, p.second);
    sort(v.begin(), v.end(), [](const pair<string,int>&a, const pair<string,int>&b){
        return a.second > b.second; });
    for (size_t i=0;i<v.size();i++) cout << v[i].first << "=" << v[i].second << " ";
    cout << "\n";
    cout << words.size() << " " << freq.size() << " " << words[0].size() << "\n";
    return 0;
}
