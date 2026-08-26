#include <iostream>
#include <deque>
using namespace std;
int main(){
    deque<int> d{1,2,3};
    cout << d.size() << " " << d.at(0) << " " << d[2] << " " << d.front() << " " << d.back() << "\n";
    d.push_front(0); d.push_back(4);
    for (size_t i=0;i<d.size();i++) cout<<d[i]<<" ";
    cout << "\n";
    d.clear();
    cout << d.size() << d.empty() << "\n";
    return 0;
}
