#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    string s = "The Quick Brown Fox";
    cout << s.length() << " " << s.find("Quick") << " " << s.substr(4,5) << "\n";
    string t; for (char c : s) t += (char)tolower(c);
    cout << t << "\n";
    t.erase(0, 4);
    cout << t << " " << t.empty() << "\n";
    t.insert(0, "AA");
    cout << t << "\n";
    string a = "abc", b = "abd";
    cout << (a < b) << (a == b) << (a != b) << "\n";
    cout << a.front() << a.back() << a.at(1) << "\n";
    a.push_back('z'); a.pop_back();
    cout << a << " " << a.size() << "\n";
    return 0;
}
