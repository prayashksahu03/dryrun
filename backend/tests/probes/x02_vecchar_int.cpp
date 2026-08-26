#include <iostream>
#include <vector>
using namespace std;
int main(){
    vector<char> c;
    c.push_back('a'); c.push_back('b');
    cout << c[0] << c[1] << " " << c.size() << "\n";
    vector<int> n;
    n.push_back('a');          // narrowing to the code point
    n.push_back(5);
    cout << n[0] << " " << n[1] << "\n";
    return 0;
}
