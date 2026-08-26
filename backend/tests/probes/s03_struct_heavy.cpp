#include <iostream>
#include <vector>
#include <algorithm>
#include <string>
using namespace std;
struct Point { int x, y; Point(){x=0;y=0;} Point(int a,int b):x(a),y(b){} };
struct Rect { Point tl, br; int area() const { return (br.x-tl.x)*(br.y-tl.y); } };
struct Item { string name; int qty; };
int main(){
    Rect r; r.tl = Point(1,1); r.br = Point(4,5);
    cout << r.area() << "\n";
    cout << r.tl.x << "," << r.tl.y << " " << r.br.x << "," << r.br.y << "\n";
    vector<Point> pts;
    pts.emplace_back(3,4); pts.emplace_back(1,2); pts.push_back(Point(5,6));
    for (size_t i = 0; i < pts.size(); i++) cout << pts[i].x << ":" << pts[i].y << " ";
    cout << "\n";
    Item it; it.name = "bolt"; it.qty = 7;
    cout << it.name << " " << it.qty << "\n";
    return 0;
}
