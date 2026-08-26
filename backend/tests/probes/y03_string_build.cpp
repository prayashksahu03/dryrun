#include <iostream>
#include <string>
#include <vector>
using namespace std;
int main(){
    vector<string> parts{"a","bb","ccc"};
    string joined;
    for (size_t i=0;i<parts.size();i++){
        joined += parts[i];
        if (i + 1 < parts.size()) joined += "-";
    }
    cout << joined << " " << joined.size() << "\n";
    string acc;
    for (const string &p : parts) acc += p[0];
    cout << acc << "\n";
    vector<string> rev;
    for (size_t i=parts.size(); i-- > 0; ) rev.push_back(parts[i]);
    for (const string &r : rev) cout << r << " ";
    cout << "\n";
    return 0;
}
