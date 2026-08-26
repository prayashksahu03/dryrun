#include <iostream>
#include <string>
#include <algorithm>
using namespace std;
int main(){
    string s = "hello world";
    cout << s.size() << " " << s.substr(0,5) << " " << s[4] << "\n";
    string t = s; reverse(t.begin(), t.end());
    cout << t << "\n";
    int vowels = 0;
    for (size_t i = 0; i < s.size(); i++)
        if (s[i]=='a'||s[i]=='e'||s[i]=='i'||s[i]=='o'||s[i]=='u') vowels++;
    cout << vowels << "\n";
    string u; for (char c : s) if (c != ' ') u.push_back(c);
    cout << u << " " << u.size() << "\n";
    return 0;
}
