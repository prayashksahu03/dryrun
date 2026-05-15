import { Trace } from '../types/trace';

const src = `int factorial(int n) {
    if (n == 0) return 1;
    return n * factorial(n - 1);
}

int main() {
    int result = factorial(4);
    return 0;
}`;

const mainOnly = (vars: Record<string, import('../types/trace').VariableValue>) => [
  { function: 'main', line: 6, variables: vars },
];

const withFactorial = (
  outerFrames: import('../types/trace').StackFrameData[],
  n: number,
  ln: number
) => [...outerFrames, { function: 'factorial', line: ln, variables: { n: { kind: 'int' as const, value: n } } }];

export const factorialTrace: Trace = {
  id: 'factorial',
  name: 'Recursion — factorial(4)',
  concept: 'recursion',
  source: src,
  steps: [
    {
      index: 0,
      line: 6,
      description: 'Program starts. main() is called.',
      event: { type: 'start' },
      memory: { stack: mainOnly({}), heap: {} },
    },
    {
      index: 1,
      line: 7,
      description: 'main() calls factorial(4). A new stack frame is pushed.',
      event: { type: 'call', function: 'factorial' },
      memory: {
        stack: withFactorial(mainOnly({}), 4, 1),
        heap: {},
      },
    },
    {
      index: 2,
      line: 2,
      description: 'factorial(4): n=4, not 0. Will call factorial(3).',
      event: { type: 'call', function: 'factorial' },
      memory: {
        stack: withFactorial(
          withFactorial(mainOnly({}), 4, 3),
          3, 1
        ),
        heap: {},
      },
    },
    {
      index: 3,
      line: 2,
      description: 'factorial(3): n=3, not 0. Will call factorial(2).',
      event: { type: 'call', function: 'factorial' },
      memory: {
        stack: withFactorial(
          withFactorial(withFactorial(mainOnly({}), 4, 3), 3, 3),
          2, 1
        ),
        heap: {},
      },
    },
    {
      index: 4,
      line: 2,
      description: 'factorial(2): n=2, not 0. Will call factorial(1).',
      event: { type: 'call', function: 'factorial' },
      memory: {
        stack: withFactorial(
          withFactorial(withFactorial(withFactorial(mainOnly({}), 4, 3), 3, 3), 2, 3),
          1, 1
        ),
        heap: {},
      },
    },
    {
      index: 5,
      line: 2,
      description: 'factorial(1): n=1, not 0. Will call factorial(0).',
      event: { type: 'call', function: 'factorial' },
      memory: {
        stack: withFactorial(
          withFactorial(withFactorial(withFactorial(withFactorial(mainOnly({}), 4, 3), 3, 3), 2, 3), 1, 3),
          0, 1
        ),
        heap: {},
      },
    },
    {
      index: 6,
      line: 2,
      description: 'Base case! factorial(0): n=0, returns 1. Frame is popped.',
      event: { type: 'return', function: 'factorial', value: '1' },
      memory: {
        stack: withFactorial(
          withFactorial(withFactorial(withFactorial(mainOnly({}), 4, 3), 3, 3), 2, 3),
          1, 3
        ),
        heap: {},
      },
    },
    {
      index: 7,
      line: 3,
      description: 'factorial(1): received 1 from factorial(0). Returns 1 × 1 = 1.',
      event: { type: 'return', function: 'factorial', value: '1' },
      memory: {
        stack: withFactorial(
          withFactorial(withFactorial(mainOnly({}), 4, 3), 3, 3),
          2, 3
        ),
        heap: {},
      },
    },
    {
      index: 8,
      line: 3,
      description: 'factorial(2): received 1 from factorial(1). Returns 2 × 1 = 2.',
      event: { type: 'return', function: 'factorial', value: '2' },
      memory: {
        stack: withFactorial(
          withFactorial(mainOnly({}), 4, 3),
          3, 3
        ),
        heap: {},
      },
    },
    {
      index: 9,
      line: 3,
      description: 'factorial(3): received 2 from factorial(2). Returns 3 × 2 = 6.',
      event: { type: 'return', function: 'factorial', value: '6' },
      memory: {
        stack: withFactorial(mainOnly({}), 4, 3),
        heap: {},
      },
    },
    {
      index: 10,
      line: 3,
      description: 'factorial(4): received 6 from factorial(3). Returns 4 × 6 = 24.',
      event: { type: 'return', function: 'factorial', value: '24' },
      memory: { stack: mainOnly({}), heap: {} },
    },
    {
      index: 11,
      line: 7,
      description: 'main() receives 24 from factorial(4). Assigns result = 24.',
      event: { type: 'assign', target: 'result', value: '24' },
      memory: {
        stack: mainOnly({ result: { kind: 'int', value: 24 } }),
        heap: {},
      },
    },
    {
      index: 12,
      line: 9,
      description: 'Program ends. result = 24 (= 4!). No heap leaks.',
      event: { type: 'end', leaks: [] },
      memory: {
        stack: mainOnly({ result: { kind: 'int', value: 24 } }),
        heap: {},
      },
    },
  ],
};
