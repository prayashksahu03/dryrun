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
int main(){ string s="abc"; s.resize(5); s.reserve(9); cout<<s.size()<<s.data(); cout<<"\n"; return 0; }
