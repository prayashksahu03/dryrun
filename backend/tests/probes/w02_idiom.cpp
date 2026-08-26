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
int main(){ vector<int> v{1,2,3}; v.reserve(10); v.shrink_to_fit(); cout<<v.capacity(); cout<<"\n"; return 0; }
