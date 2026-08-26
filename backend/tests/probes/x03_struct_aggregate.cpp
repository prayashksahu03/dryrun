#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
using namespace std;
struct Item { string name; int qty; };
struct Point { int x, y; };
struct Box { Point tl; int w; };
int main(){
    vector<Item> v;
    v.push_back({"pen",3});
    v.emplace_back(Item{"book",5});
    v.push_back(Item{"ink",1});
    for (size_t i=0;i<v.size();i++) cout << v[i].name << "=" << v[i].qty << " ";
    cout << "\n";
    sort(v.begin(), v.end(), [](const Item&a, const Item&b){ return a.qty < b.qty; });
    for (const Item &it : v) cout << it.name << " ";
    cout << "\n";
    Item single = {"cap", 9};
    cout << single.name << " " << single.qty << "\n";
    Box b{{1,2},7};
    cout << b.tl.x << " " << b.tl.y << " " << b.w << "\n";
    Point p = {4,5};
    cout << p.x << p.y << "\n";
    return 0;
}
