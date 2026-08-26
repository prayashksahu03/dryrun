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
int main(){ string s="abc"; s.erase(0,1); s.insert(0,"z"); s.clear(); cout<<s.empty(); cout<<"\n"; return 0; }
