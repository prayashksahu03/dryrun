#include <iostream>
#include <string>
#include <vector>
using namespace std;
struct Item { string name; int qty; };
int main(){ vector<Item> v; v.push_back({"pen",3});
  cout << v[0].name << " " << v[0].qty << "\n"; }
