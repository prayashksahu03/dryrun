#include <iostream>
#include <vector>
#include <string>
#include <map>
#include <set>
#include <deque>
#include <queue>
#include <stack>
#include <algorithm>
#include <utility>
#include <numeric>
using namespace std;
int main(){ vector<vector<int>> g(3); g[0].push_back(1); g[0].emplace_back(2); cout<<g[0].size()<<g[0].at(0); cout<<"\n"; return 0; }
