#include <iostream>
#include <vector>
#include <utility>
#include <algorithm>
using namespace std;
int main(){
    vector<pair<int,int>> v{{3,1},{1,2},{2,3}};
    sort(v.begin(), v.end());
    for (auto &p : v) cout << p.first << "," << p.second << " ";
    cout << "\n";
    vector<vector<int>> g{{1,2,3},{4,5,6}};
    for (size_t i=0;i<g.size();i++){ for(size_t j=0;j<g[i].size();j++) cout<<g[i][j]<<" "; cout<<"|"; }
    cout << "\n";
    vector<vector<int>> adj(3);
    adj[0].push_back(1); adj[0].push_back(2); adj[1].emplace_back(2);
    cout << adj[0].size() << adj[1].size() << adj[2].size() << " " << adj[0][1] << "\n";
    return 0;
}
