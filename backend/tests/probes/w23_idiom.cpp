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
int main(){ map<int,vector<int>> m; m[1].push_back(7); cout<<m[1].size()<<m[1][0]; cout<<"\n"; return 0; }
