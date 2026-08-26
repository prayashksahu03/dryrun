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
int main(){ multiset<int> ms; ms.insert(1); ms.insert(1); cout<<ms.size()<<ms.count(1); cout<<"\n"; return 0; }
