#include <iostream>
#include <string>
#include <vector>
using namespace std;
int main(){
    vector<string> v(3, "zz");
    cout << v.size() << v[0] << v[2] << "\n";
    v.assign(2, "q");
    cout << v.size() << v[0] << v[1] << "\n";
    v.resize(4);
    cout << v.size() << "[" << v[3] << "]\n";
    v[0] = "hello";
    v[0] += "!";
    cout << v[0] << " " << v[0].size() << "\n";
    vector<string> a{"p","q"}, b{"z"};
    a.swap(b);
    cout << a.size() << b.size() << a[0] << b[0] << b[1] << "\n";
    return 0;
}
