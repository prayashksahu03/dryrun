#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
using namespace std;
struct Student { string name; int score; };
Student best(const vector<Student>& v){
    Student b = v[0];
    for (size_t i=1;i<v.size();i++) if (v[i].score > b.score) b = v[i];
    return b;
}
int main(){
    vector<Student> v;
    v.push_back({"ann",70});
    v.emplace_back(Student{"bob",91});
    v.push_back(Student{"cy",84});
    for (const Student &s : v) cout << s.name << "/" << s.score << " ";
    cout << "\n";
    Student b = best(v);
    cout << b.name << " " << b.score << "\n";
    sort(v.begin(), v.end(), [](const Student&a, const Student&c){ return a.name < c.name; });
    for (size_t i=0;i<v.size();i++) cout << v[i].name << " ";
    cout << "\n";
    cout << v[0].name.size() << " " << v[0].name[0] << "\n";
    return 0;
}
