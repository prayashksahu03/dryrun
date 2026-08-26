#include <iostream>
using namespace std;
struct Node { int v; Node* next; };
int main(){
    Node* p = nullptr;
    cout << "start\n";
    cout << p->v << "\n";
    return 0;
}
