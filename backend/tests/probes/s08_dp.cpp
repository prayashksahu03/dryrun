#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
int main(){
    int W = 10;
    vector<int> wt{2,3,4,5}, val{3,4,5,6};
    vector<vector<int>> dp(wt.size()+1, vector<int>(W+1, 0));
    for (size_t i = 1; i <= wt.size(); i++)
        for (int w = 0; w <= W; w++){
            dp[i][w] = dp[i-1][w];
            if (wt[i-1] <= w) dp[i][w] = max(dp[i][w], dp[i-1][w-wt[i-1]] + val[i-1]);
        }
    cout << dp[wt.size()][W] << "\n";
    vector<int> a{10,9,2,5,3,7,101,18};
    vector<int> lis(a.size(), 1);
    for (size_t i=0;i<a.size();i++) for(size_t j=0;j<i;j++) if(a[j]<a[i]) lis[i]=max(lis[i],lis[j]+1);
    cout << *max_element(lis.begin(), lis.end()) << "\n";
    return 0;
}
