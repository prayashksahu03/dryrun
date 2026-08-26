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
int main(){ map<int,int> m; m[1]=2; m.insert({3,4}); m.emplace(5,6); cout<<m.size()<<m.count(1)<<m.at(1); cout<<"\n"; return 0; }
