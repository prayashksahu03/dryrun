#include <iostream>
#include <string>
using namespace std;
class Shape {
protected:
    string name;
public:
    Shape() : name("shape") {}
    Shape(string n) : name(n) {}
    string getName() const { return name; }
};
class Circle : public Shape {
    int r;
public:
    Circle() : Shape("circle"), r(1) {}
    Circle(int rr) : Shape("circle"), r(rr) {}
    int area10() const { return 314 * r * r / 100; }
};
int main(){
    Circle c(3);
    cout << c.getName() << " " << c.area10() << "\n";
    Circle d;
    cout << d.getName() << " " << d.area10() << "\n";
    return 0;
}
