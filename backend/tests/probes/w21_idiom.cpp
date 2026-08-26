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
int main(){ priority_queue<int> pq; pq.push(3); pq.push(1); cout<<pq.top()<<pq.size(); pq.pop(); cout<<"\n"; return 0; }
