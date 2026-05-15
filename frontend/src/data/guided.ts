import { TraceStep } from '../types/trace';

// ── Hint rule types ───────────────────────────────────────────────────────

export type HintRule =
  | { trigger: 'line';  line: number; hint: string }
  | { trigger: 'event'; type: string; nth: number;  hint: string };

export interface GuidedProgram {
  id: string;
  title: string;
  concept: string;
  description: string;
  source: string;
  stdin?: string;
  hints: HintRule[];
}

// ── Hint resolution ───────────────────────────────────────────────────────
// Returns a map of stepIndex → hint string, computed once after the trace loads.

export function resolveHints(steps: TraceStep[], rules: HintRule[]): Map<number, string> {
  const result      = new Map<number, string>();
  const lineVisited = new Set<number>();
  const eventCounts: Record<string, number> = {};

  steps.forEach((step, i) => {
    const evType = step.event.type;
    eventCounts[evType] = (eventCounts[evType] ?? 0) + 1;

    for (const rule of rules) {
      if (result.has(i)) break; // one hint per step

      if (rule.trigger === 'line') {
        if (step.line === rule.line && !lineVisited.has(rule.line)) {
          result.set(i, rule.hint);
          lineVisited.add(rule.line);
        }
      } else if (rule.trigger === 'event') {
        if (evType === rule.type && eventCounts[evType] === rule.nth) {
          result.set(i, rule.hint);
        }
      }
    }
  });

  return result;
}

// ── Guided programs ───────────────────────────────────────────────────────

export const GUIDED_PROGRAMS: GuidedProgram[] = [

  // ── 1. Pointers & Addresses ────────────────────────────────────────────
  {
    id: 'pointers',
    title: 'Pointers & Addresses',
    concept: 'Pointers',
    description: 'How & and * work, what NULL means, and what happens when you dereference it.',
    source: `#include <bits/stdc++.h>
using namespace std;
int main() {
    int x = 42;
    int* p = &x;
    *p = 100;
    int* q = nullptr;
    cout << *q << endl;
}`,
    hints: [
      { trigger: 'line',  line: 4,   hint: 'x is born on the stack — a named memory location holding 42. Every variable has an address.' },
      { trigger: 'line',  line: 5,   hint: 'p stores the address of x, not x itself. The green arrow from p → x shows they share the same memory location.' },
      { trigger: 'line',  line: 6,   hint: 'Writing through *p modifies x directly. p and x share the same location — change one and you change both.' },
      { trigger: 'line',  line: 7,   hint: 'nullptr means "points to nothing" — address zero. It is valid to hold but illegal to read or write through.' },
      { trigger: 'event', type: 'crash', nth: 1, hint: 'Dereferencing nullptr crashes the program. This is a segmentation fault — the most common runtime error in C++.' },
    ],
  },

  // ── 2. Heap: Alloc, Write & Crash ─────────────────────────────────────
  {
    id: 'heap',
    title: 'Heap: Alloc, Write & Crash',
    concept: 'Heap & new/delete',
    description: 'How new allocates on the heap, what delete does, and what use-after-free looks like.',
    source: `#include <bits/stdc++.h>
using namespace std;
int main() {
    int* p = new int(5);
    *p = 42;
    delete p;
    cout << *p << endl;
}`,
    hints: [
      { trigger: 'event', type: 'malloc', nth: 1, hint: 'new allocates a block on the heap — a separate memory region that persists until you explicitly free it. Watch the green card appear on the right.' },
      { trigger: 'line',  line: 5,        hint: 'p on the stack is just an address. The actual value lives in the heap block it points to. Modifying *p updates that block.' },
      { trigger: 'event', type: 'free',   nth: 1, hint: 'delete returns the heap block to the OS. The block turns red-striped — the memory is gone and p is now a dangling pointer.' },
      { trigger: 'event', type: 'crash',  nth: 1, hint: 'p still holds the old address but the memory was freed. Reading it is use-after-free — undefined behavior, almost always a crash.' },
    ],
  },

  // ── 3. Memory Leaks ────────────────────────────────────────────────────
  {
    id: 'memory-leaks',
    title: 'Memory Leaks',
    concept: 'Memory leaks',
    description: 'Allocate three heap blocks, free only one — see which blocks survive to the end and appear as leaks.',
    source: `#include <bits/stdc++.h>
using namespace std;
int main() {
    int* a = new int(10);
    int* b = new int(20);
    int* c = new int(30);
    *b = 999;
    delete b;
    cout << *a + *c << endl;
}`,
    hints: [
      { trigger: 'event', type: 'malloc', nth: 1, hint: 'First heap block created for a. Three will be allocated — watch which ones turn red-striped at the end versus which stay green.' },
      { trigger: 'event', type: 'malloc', nth: 3, hint: 'All three blocks live on the heap simultaneously. Scroll the heap panel to see them side by side.' },
      { trigger: 'line',  line: 7,        hint: '*b = 999 writes into b\'s block through the pointer. The field in the heap card flashes amber to show the write.' },
      { trigger: 'event', type: 'free',   nth: 1, hint: 'b\'s block is freed and turns red-striped. a and c are still allocated — and nothing in this program will ever free them.' },
      { trigger: 'event', type: 'end',    nth: 1, hint: 'Program ended with 2 leaked blocks. Check the Inspector — it lists the leaked addresses. In long-running programs, repeated leaks exhaust system memory.' },
    ],
  },

  // ── 4. Recursion & the Call Stack ─────────────────────────────────────
  {
    id: 'recursion',
    title: 'Recursion & the Call Stack',
    concept: 'Recursion',
    description: 'Watch factorial(5) build a tower of stack frames and unwind them one by one.',
    source: `#include <bits/stdc++.h>
using namespace std;
int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
int main() {
    int result = factorial(5);
    cout << result << endl;
}`,
    hints: [
      { trigger: 'event', type: 'call',   nth: 1, hint: 'factorial(5) pushes the first frame onto the call stack. Each recursive call adds another frame with its own copy of n.' },
      { trigger: 'event', type: 'call',   nth: 3, hint: 'Three frames deep. Notice each frame has a different value of n — they are completely independent copies.' },
      { trigger: 'event', type: 'call',   nth: 5, hint: 'n = 1 — the base case. No more recursive calls. The stack is at its deepest point; now it unwinds.' },
      { trigger: 'event', type: 'return', nth: 1, hint: 'The base case returns 1. Its frame is popped and the value is passed back to the caller.' },
      { trigger: 'event', type: 'return', nth: 5, hint: 'All frames resolved. The final product propagates back to main — 5 × 4 × 3 × 2 × 1 = 120.' },
    ],
  },

  // ── 5. Linked List ─────────────────────────────────────────────────────
  {
    id: 'linked-list',
    title: 'Linked List',
    concept: 'Linked structures',
    description: 'Build a three-node linked list and traverse it — watch the pointer chain form in the heap.',
    source: `#include <bits/stdc++.h>
using namespace std;
struct Node {
    int val;
    Node* next;
};
int main() {
    Node* head = new Node{1, nullptr};
    head->next = new Node{2, nullptr};
    head->next->next = new Node{3, nullptr};
    Node* curr = head;
    while (curr != nullptr) {
        cout << curr->val << endl;
        curr = curr->next;
    }
}`,
    hints: [
      { trigger: 'event', type: 'malloc', nth: 1, hint: 'The first node is allocated on the heap. head on the stack holds its address — the start of the list.' },
      { trigger: 'event', type: 'malloc', nth: 2, hint: 'A second node is linked by setting head->next. Watch the green arrow connect the two heap blocks.' },
      { trigger: 'event', type: 'malloc', nth: 3, hint: 'Three nodes now form a chain. Each next pointer leads to the following node — follow the arrows right to left.' },
      { trigger: 'line',  line: 11,       hint: 'curr is a traversal pointer that starts at head. It will hop along the next arrows until it hits nullptr.' },
      { trigger: 'line',  line: 14,       hint: 'curr = curr->next advances to the next node. The previous node is still in the heap — we just moved our view of the list.' },
    ],
  },

  // ── 6. Binary Search ──────────────────────────────────────────────────
  {
    id: 'binary-search',
    title: 'Binary Search',
    concept: 'Two-pointer / Binary search',
    description: 'Watch lo, mid, and hi narrow the search window on a sorted array step by step.',
    source: `#include <bits/stdc++.h>
using namespace std;
int main() {
    vector<int> arr = {1, 3, 5, 7, 9, 11, 13};
    int target = 7;
    int lo = 0, hi = (int)arr.size() - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) {
            cout << "found at " << mid << endl;
            break;
        } else if (arr[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
}`,
    hints: [
      { trigger: 'line', line: 4,  hint: 'The array must be sorted for binary search to work. lo, mid, and hi will appear as pointer arrows above the cells.' },
      { trigger: 'line', line: 6,  hint: 'lo and hi bracket the entire search space. Each iteration, mid bisects the remaining window.' },
      { trigger: 'line', line: 8,  hint: 'mid = lo + (hi-lo)/2 avoids integer overflow. Watch the mid arrow jump to the center of the window.' },
      { trigger: 'line', line: 13, hint: 'arr[mid] < target — the answer must be to the RIGHT of mid. lo advances past mid, cutting the left half.' },
      { trigger: 'line', line: 15, hint: 'arr[mid] > target — the answer must be to the LEFT of mid. hi retreats below mid, cutting the right half.' },
    ],
  },

  // ── 7. Stack & Queue ──────────────────────────────────────────────────
  {
    id: 'stack-queue',
    title: 'Stack & Queue',
    concept: 'STL containers',
    description: 'Push and pop from std::stack (LIFO) and std::queue (FIFO) — see both visualized live in the stack frame.',
    source: `#include <bits/stdc++.h>
using namespace std;
int main() {
    stack<int> s;
    s.push(1);
    s.push(2);
    s.push(3);
    cout << s.top() << endl;
    s.pop();
    cout << s.top() << endl;
    queue<int> fifo;
    fifo.push(10);
    fifo.push(20);
    fifo.push(30);
    cout << fifo.front() << endl;
    fifo.pop();
    cout << fifo.front() << endl;
}`,
    hints: [
      { trigger: 'line', line: 4,  hint: 'stack<int> visualizes as a vertical column in the frame panel. Elements are added and removed from the top only — LIFO: Last In, First Out.' },
      { trigger: 'line', line: 6,  hint: 'Push 1, 2, 3 — watch the column grow upward. The most recently pushed element always sits at the top.' },
      { trigger: 'line', line: 8,  hint: 'top() reads 3 without removing it. 3 was pushed last so it sits on top — that\'s the defining property of LIFO.' },
      { trigger: 'line', line: 9,  hint: 'pop() removes from the top. 3 exits first, even though 1 has been there longest. LIFO reverses insertion order.' },
      { trigger: 'line', line: 11, hint: 'queue<int> visualizes horizontally. Elements enter at the back and leave from the front — FIFO: First In, First Out.' },
      { trigger: 'line', line: 15, hint: 'front() reads 10 — the oldest element. 10 was pushed first so it leads the queue.' },
      { trigger: 'line', line: 16, hint: 'pop() removes from the front. 10 exits first because it arrived first. FIFO preserves insertion order — the opposite of a stack.' },
    ],
  },

  // ── 8. Graph BFS ──────────────────────────────────────────────────────
  {
    id: 'graph-bfs',
    title: 'Graph BFS',
    concept: 'Graph traversal',
    description: 'Build an adjacency list for a 5-node graph and traverse it breadth-first — watch the queue drive the exploration.',
    source: `#include <bits/stdc++.h>
using namespace std;
int main() {
    vector<vector<int>> adj(5);
    adj[0].push_back(1);
    adj[0].push_back(2);
    adj[1].push_back(3);
    adj[2].push_back(4);
    int vis[5] = {};
    queue<int> bfsQ;
    bfsQ.push(0);
    vis[0] = 1;
    while (!bfsQ.empty()) {
        int node = bfsQ.front();
        bfsQ.pop();
        cout << node << endl;
        for (int nb : adj[node])
            if (!vis[nb]) { vis[nb] = 1; bfsQ.push(nb); }
    }
}`,
    hints: [
      { trigger: 'line',  line: 4,        hint: 'adj is a vector of adjacency lists. adj[i] holds node i\'s neighbors. This graph: 0→{1,2}, 1→{3}, 2→{4}.' },
      { trigger: 'line',  line: 9,        hint: 'vis[] marks visited nodes — prevents revisiting and infinite loops in cyclic graphs. 0 = unvisited, 1 = visited.' },
      { trigger: 'line',  line: 11,       hint: 'Source node 0 enters the BFS queue. BFS always starts by enqueuing the source, then fans outward level by level.' },
      { trigger: 'event', type: 'output', nth: 1, hint: 'Node 0 visited. Its neighbors 1 and 2 are now queued — they form the next level of the graph out from node 0.' },
      { trigger: 'event', type: 'output', nth: 3, hint: 'Node 2 visited. Notice BFS explores layer by layer: {0} first, then {1, 2}, then {3, 4}. This guarantees shortest-path order.' },
    ],
  },

  // ── 9. Reading from stdin ──────────────────────────────────────────────
  {
    id: 'stdin',
    title: 'Reading from stdin',
    concept: 'stdin / cin',
    description: 'Read n numbers from cin, accumulate their sum — see each input token land in a variable as you step through.',
    source: `#include <bits/stdc++.h>
using namespace std;
int main() {
    int n;
    cin >> n;
    int sum = 0;
    for (int i = 0; i < n; i++) {
        int x;
        cin >> x;
        sum += x;
    }
    cout << sum << endl;
}`,
    stdin: '4\n10 20 30 40',
    hints: [
      { trigger: 'line',  line: 4,        hint: 'n is read from the stdin panel below the editor. The preset input "4 10 20 30 40" is already loaded — 4 numbers that sum to 100.' },
      { trigger: 'line',  line: 5,        hint: 'sum starts at 0 and will accumulate each value. Watch it update in the stack frame on every loop iteration.' },
      { trigger: 'line',  line: 9,        hint: 'cin >> x reads the next whitespace-delimited token from stdin. Each call advances the input cursor by one value.' },
      { trigger: 'line',  line: 10,       hint: 'sum += x adds the latest token to the running total. Step through the loop to watch sum grow: 10 → 30 → 60 → 100.' },
      { trigger: 'event', type: 'output', nth: 1, hint: 'Final sum printed. Try editing the stdin panel with different numbers or a different n and re-running — the trace updates instantly.' },
    ],
  },

];
