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
int main(){ deque<int> d; d.push_back(1); d.push_front(0); d.pop_back(); d.pop_front(); cout<<d.size()<<d.empty(); cout<<"\n"; return 0; }
