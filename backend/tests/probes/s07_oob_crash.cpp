#include <iostream>
#include <vector>
using namespace std;
int main(){
    vector<int> v{1,2,3};
    cout << "before\n";
    cout << v.at(10) << "\n";
    cout << "after\n";
    return 0;
}
