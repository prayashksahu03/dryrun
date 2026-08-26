#include <iostream>
#include <string>
#include <vector>
using namespace std;
int main(){ vector<string> v; v.push_back("pen"); v.push_back("book");
  string o; for (size_t i=0;i<v.size();i++) o += v[i] + ",";
  cout << o << "\n"; }
