#include <iostream>
#include <string>
#include <vector>
using namespace std;
struct Item { string name; int qty; };
int main(){ vector<Item> v; v.emplace_back(Item{"book",5});
  cout << v[0].name << " " << v[0].qty << "\n"; }
