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
int main(){ set<int> s{1,2,3}; s.erase(2); s.clear(); cout<<s.empty(); cout<<"\n"; return 0; }
