#include <iostream>
using namespace std;
int fib(int n){ return n < 2 ? n : fib(n-1) + fib(n-2); }
int fact(int n){ return n <= 1 ? 1 : n * fact(n-1); }
void hanoi(int n, char a, char b, char c, int &moves){
    if (n == 0) return;
    hanoi(n-1, a, c, b, moves); moves++; hanoi(n-1, c, b, a, moves);
}
int main(){
    for (int i = 0; i < 10; i++) cout << fib(i) << " ";
    cout << "\n" << fact(6) << "\n";
    int m = 0; hanoi(4, 'A','B','C', m); cout << m << "\n";
    return 0;
}
