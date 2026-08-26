#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    int n; cin >> n;
    vector<int> a(n);
    for (int i=0;i<n;i++) cin>>a[i];
    sort(a.begin(), a.end());
    long long sum=0; for(int x:a) sum+=x;
    cout<<sum<<" "<<a[0]<<" "<<a[n-1]<<"\n";
    int target; cin>>target;
    int lo=0, hi=n-1, found=0;
    while(lo<hi){ int s=a[lo]+a[hi]; if(s==target){found=1;break;} else if(s<target) lo++; else hi--; }
    cout<<found<<"\n";
    return 0;
}
