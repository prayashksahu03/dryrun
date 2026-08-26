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
int main(){ set<int> s; s.insert(1); s.emplace(2); cout<<s.size()<<s.count(1)<<*s.begin()<<*s.rbegin(); cout<<"\n"; return 0; }
