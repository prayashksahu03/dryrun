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
int main(){ map<int,int> m; m[1]=2; for(auto&p:m) cout<<p.first<<p.second; cout<<(m.find(1)!=m.end()); cout<<"\n"; return 0; }
