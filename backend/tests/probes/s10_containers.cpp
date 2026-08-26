#include <iostream>
#include <vector>
#include <deque>
#include <stack>
#include <queue>
using namespace std;
int main(){
    deque<int> d; d.push_back(2); d.push_front(1); d.push_back(3);
    for (size_t i=0;i<d.size();i++) cout<<d[i]<<" ";
    cout<<"\n"<<d.at(1)<<" "<<d.front()<<" "<<d.back()<<"\n";
    stack<int> st; st.push(1); st.push(2); st.push(3);
    while(!st.empty()){ cout<<st.top()<<" "; st.pop(); }
    cout<<"\n";
    queue<int> q; q.push(7); q.push(8);
    while(!q.empty()){ cout<<q.front()<<" "; q.pop(); }
    cout<<"\n";
    vector<int> v{1,2,3,4,5};
    v.erase(v.begin()+1);
    v.insert(v.begin(), 0);
    for(int x:v) cout<<x<<" ";
    cout<<"\n";
    vector<int> a{1,2}, b{9,9,9};
    a.swap(b);
    cout<<a.size()<<" "<<b.size()<<"\n";
    return 0;
}
