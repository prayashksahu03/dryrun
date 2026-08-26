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
int main(){ set<int> s{1,5,9}; cout<<(*s.lower_bound(4))<<(*s.upper_bound(5)); cout<<"\n"; return 0; }
