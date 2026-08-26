#include <iostream>
#include <deque>
#include <vector>
using namespace std;
int main(){
    vector<int> a{1,3,-1,-3,5,3,6,7};
    int k = 3;
    deque<int> dq;
    for (size_t i = 0; i < a.size(); i++){
        while(!dq.empty() && dq.front() <= (int)i - k) dq.pop_front();
        while(!dq.empty() && a[dq.back()] <= a[i]) dq.pop_back();
        dq.push_back(i);
        if ((int)i >= k-1) cout << a[dq.front()] << " ";
    }
    cout << "\n";
    return 0;
}
