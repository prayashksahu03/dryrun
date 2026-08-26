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
int main(){ vector<int> v{1,2,3}; v.erase(v.begin()); v.insert(v.begin(),9); cout<<v[0]; cout<<"\n"; return 0; }
