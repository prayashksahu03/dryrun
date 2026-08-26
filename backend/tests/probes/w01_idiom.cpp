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
int main(){ vector<int> v; v.push_back(1); v.emplace_back(2); v.pop_back(); v.clear(); v.resize(3); v.assign(2,5); cout<<v.size(); cout<<"\n"; return 0; }
