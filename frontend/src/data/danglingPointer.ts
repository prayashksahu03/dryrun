import { Trace } from '../types/trace';

export const danglingPointerTrace: Trace = {
  id: 'dangling-pointer-01',
  name: 'Dangling Pointer: Use-After-Free',
  concept: 'dangling-pointer',
  source: `#include <stdlib.h>
#include <stdio.h>

struct Node {
    int val;
    struct Node *next;
};

int main() {
    struct Node *a = malloc(sizeof(struct Node));
    struct Node *b = malloc(sizeof(struct Node));

    a->val = 1;
    b->val = 2;
    a->next = b;

    free(b);

    // a->next still points to freed memory!
    printf("%d\\n", a->next->val);

    return 0;
}`,
  steps: [
    {
      index: 0,
      line: 9,
      description: 'Program starts. main() is pushed onto the stack. Pointer variables a and b are uninitialized.',
      event: { type: 'start' },
      memory: {
        stack: [{
          function: 'main', line: 9,
          variables: {
            a: { kind: 'pointer', address: null },
            b: { kind: 'pointer', address: null },
          }
        }],
        heap: {}
      }
    },
    {
      index: 1,
      line: 10,
      description: 'malloc(sizeof(Node)) allocates 16 bytes on the heap. Returns address 0x1a40. Variable a now holds this address.',
      event: { type: 'malloc', address: '0x1a40', size: 16, typeName: 'Node' },
      memory: {
        stack: [{
          function: 'main', line: 10,
          variables: {
            a: { kind: 'pointer', address: '0x1a40' },
            b: { kind: 'pointer', address: null },
          }
        }],
        heap: {
          '0x1a40': {
            address: '0x1a40', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 0 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 10
          }
        }
      }
    },
    {
      index: 2,
      line: 11,
      description: 'Second malloc allocates another 16 bytes. Returns address 0x2b80. Variable b holds this address.',
      event: { type: 'malloc', address: '0x2b80', size: 16, typeName: 'Node' },
      memory: {
        stack: [{
          function: 'main', line: 11,
          variables: {
            a: { kind: 'pointer', address: '0x1a40' },
            b: { kind: 'pointer', address: '0x2b80' },
          }
        }],
        heap: {
          '0x1a40': {
            address: '0x1a40', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 0 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 10
          },
          '0x2b80': {
            address: '0x2b80', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 0 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 11
          }
        }
      }
    },
    {
      index: 3,
      line: 13,
      description: 'a->val = 1. Dereferences pointer a (follows it to 0x1a40), then writes 1 into the val field.',
      event: { type: 'assign', target: 'a->val', value: '1' },
      memory: {
        stack: [{
          function: 'main', line: 13,
          variables: {
            a: { kind: 'pointer', address: '0x1a40' },
            b: { kind: 'pointer', address: '0x2b80' },
          }
        }],
        heap: {
          '0x1a40': {
            address: '0x1a40', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 1 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 10
          },
          '0x2b80': {
            address: '0x2b80', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 0 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 11
          }
        }
      }
    },
    {
      index: 4,
      line: 14,
      description: 'b->val = 2. Follows b to 0x2b80, writes 2 into val field.',
      event: { type: 'assign', target: 'b->val', value: '2' },
      memory: {
        stack: [{
          function: 'main', line: 14,
          variables: {
            a: { kind: 'pointer', address: '0x1a40' },
            b: { kind: 'pointer', address: '0x2b80' },
          }
        }],
        heap: {
          '0x1a40': {
            address: '0x1a40', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 1 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 10
          },
          '0x2b80': {
            address: '0x2b80', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 2 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 11
          }
        }
      }
    },
    {
      index: 5,
      line: 15,
      description: 'a->next = b. The next field of Node a is set to 0x2b80 — the address of Node b. Two nodes are now linked.',
      event: { type: 'assign', target: 'a->next', value: '0x2b80' },
      memory: {
        stack: [{
          function: 'main', line: 15,
          variables: {
            a: { kind: 'pointer', address: '0x1a40' },
            b: { kind: 'pointer', address: '0x2b80' },
          }
        }],
        heap: {
          '0x1a40': {
            address: '0x1a40', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 1 },
              next: { kind: 'pointer', address: '0x2b80' },
            },
            allocatedAtLine: 10
          },
          '0x2b80': {
            address: '0x2b80', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 2 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 11
          }
        }
      }
    },
    {
      index: 6,
      line: 17,
      description: 'free(b) releases 0x2b80 back to the OS. CRITICAL: a->next still holds 0x2b80. That pointer is now dangling.',
      event: { type: 'free', address: '0x2b80' },
      memory: {
        stack: [{
          function: 'main', line: 17,
          variables: {
            a: { kind: 'pointer', address: '0x1a40' },
            b: { kind: 'pointer', address: '0x2b80' },
          }
        }],
        heap: {
          '0x1a40': {
            address: '0x1a40', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 1 },
              next: { kind: 'pointer', address: '0x2b80' },
            },
            allocatedAtLine: 10
          },
          '0x2b80': {
            address: '0x2b80', size: 16, typeName: 'Node', state: 'freed',
            fields: {
              val:  { kind: 'int', value: 2 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 11,
            freedAtLine: 17
          }
        }
      }
    },
    {
      index: 7,
      line: 20,
      description: 'CRASH — a->next->val dereferences freed memory at 0x2b80. This block was released at line 17. Undefined behavior.',
      event: {
        type: 'crash',
        kind: 'use-after-free',
        address: '0x2b80',
        message: 'Use-after-free: dereferencing freed memory at 0x2b80. a->next is a dangling pointer (freed at line 17).'
      },
      memory: {
        stack: [{
          function: 'main', line: 20,
          variables: {
            a: { kind: 'pointer', address: '0x1a40' },
            b: { kind: 'pointer', address: '0x2b80' },
          }
        }],
        heap: {
          '0x1a40': {
            address: '0x1a40', size: 16, typeName: 'Node', state: 'allocated',
            fields: {
              val:  { kind: 'int', value: 1 },
              next: { kind: 'pointer', address: '0x2b80' },
            },
            allocatedAtLine: 10
          },
          '0x2b80': {
            address: '0x2b80', size: 16, typeName: 'Node', state: 'freed',
            fields: {
              val:  { kind: 'int', value: 2 },
              next: { kind: 'pointer', address: null },
            },
            allocatedAtLine: 11,
            freedAtLine: 17
          }
        }
      }
    }
  ]
};
