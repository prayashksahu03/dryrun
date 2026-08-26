#include <iostream>
#include <vector>
using namespace std;
int main(){
    int n = 3;
    vector<vector<int>> A(n, vector<int>(n));
    for (int i=0;i<n;i++) for(int j=0;j<n;j++) A[i][j]=i*n+j;
    vector<vector<int>> B(n, vector<int>(n, 0));
    for (int i=0;i<n;i++) for(int j=0;j<n;j++) B[j][i]=A[i][j];
    for (int i=0;i<n;i++){ for(int j=0;j<n;j++) cout<<B[i][j]<<" "; cout<<"\n"; }
    int tr=0; for(int i=0;i<n;i++) tr+=A[i][i];
    cout<<tr<<"\n";
    return 0;
}
