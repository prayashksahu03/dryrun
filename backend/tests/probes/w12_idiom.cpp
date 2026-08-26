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
int main(){ map<int,int> m; m[1]=2; m.erase(1); m.clear(); cout<<m.empty(); cout<<"\n"; return 0; }
