#include <iostream>
using namespace std;
struct Node { int val; Node* next; };
class Counter {
    int n;
public:
    Counter() : n(0) {}
    void inc(){ n++; }
    int get() const { return n; }
};
int main(){
    Node* head = new Node{1, nullptr};
    head->next = new Node{2, nullptr};
    head->next->next = new Node{3, nullptr};
    for (Node* p = head; p != nullptr; p = p->next) cout << p->val << " ";
    cout << "\n";
    Counter c; for (int i=0;i<5;i++) c.inc();
    cout << c.get() << "\n";
    delete head->next->next; delete head->next; delete head;
    return 0;
}
