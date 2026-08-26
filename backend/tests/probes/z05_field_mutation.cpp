#include <iostream>
#include <string>
#include <vector>
using namespace std;
struct S { string name; int n; };
int main(){
    vector<S> v;
    v.push_back({"ann",1});
    v[0].name.push_back('!');
    v[0].n = 42;
    v[0].name += "?";
    cout << v[0].name << " " << v[0].name.size() << " " << v[0].n << "\n";
    return 0;
}
