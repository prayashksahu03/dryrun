#include <iostream>
#include <vector>
#include <queue>
using namespace std;
int main(){
    int n, m; cin >> n >> m;
    vector<vector<int>> adj(n+1);
    for (int i = 0; i < m; i++){ int a,b; cin>>a>>b; adj[a].push_back(b); adj[b].push_back(a); }
    vector<int> dist(n+1, -1);
    queue<int> q; q.push(1); dist[1]=0;
    while(!q.empty()){
        int u=q.front(); q.pop();
        for (size_t i=0;i<adj[u].size();i++){ int v=adj[u][i]; if(dist[v]==-1){dist[v]=dist[u]+1;q.push(v);} }
    }
    for (int i=1;i<=n;i++) cout<<dist[i]<<" ";
    cout<<"\n";
    return 0;
}
