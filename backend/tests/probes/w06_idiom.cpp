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
int main(){ vector<int> v{1,2,3}; cout<<accumulate(v.begin(),v.end(),0); cout<<"\n"; return 0; }
