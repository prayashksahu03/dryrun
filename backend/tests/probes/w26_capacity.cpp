#include <iostream>
#include <vector>
using namespace std;
int main(){
    vector<int> a; for(int i=0;i<5;i++) a.push_back(i);
    cout << a.size() << " " << a.capacity() << "\n";
    vector<int> b{1,2,3};
    cout << b.size() << " " << b.capacity() << "\n";
    b.push_back(4);
    cout << b.size() << " " << b.capacity() << "\n";
    b.reserve(20);
    cout << b.capacity() << "\n";
    b.shrink_to_fit();
    cout << b.capacity() << "\n";
    vector<int> c(7);
    cout << c.size() << " " << c.capacity() << "\n";
    return 0;
}
