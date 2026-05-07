import type { FunctionSignature, TestCase, TestPlan } from './types.js';

function boundaryValuesForType(type: string): unknown[] {
  const t = type.toLowerCase().replace(/\s/g, '');
  if (t.includes('string')) {
    return ['', ' ', 'a', 'a'.repeat(1000), null, undefined];
  }
  if (t.includes('number')) {
    return [0, -0, -1, 1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, null, undefined];
  }
  if (t.includes('boolean')) {
    return [true, false, null, undefined];
  }
  if (t.includes('[]') || t.includes('array')) {
    return [[], [null], [undefined], null, undefined];
  }
  if (t.includes('{}') || t.includes('object') || t.includes('record')) {
    return [{}, { key: null }, null, undefined];
  }
  // unknown / any — probe a spread
  return [null, undefined, '', 0, [], {}];
}

function happyValueForType(type: string, paramName: string): unknown {
  const t = type.toLowerCase().replace(/\s/g, '');
  const n = paramName.toLowerCase();

  if (t.includes('string')) {
    if (n.includes('name')) return 'Alice';
    if (n.includes('email')) return 'alice@example.com';
    if (n.includes('url')) return 'https://example.com';
    if (n.includes('id')) return 'abc-123';
    return 'hello';
  }
  if (t.includes('number')) {
    if (n.includes('min')) return 0;
    if (n.includes('max')) return 100;
    if (n.includes('count') || n.includes('length')) return 5;
    return 42;
  }
  if (t.includes('boolean')) return true;
  if (t.includes('[]') || t.includes('array')) return [1, 2, 3];
  return {};
}

function generateBoundaryCases(sig: FunctionSignature): TestCase[] {
  const cases: TestCase[] = [];

  for (const param of sig.params) {
    for (const value of boundaryValuesForType(param.type)) {
      const inputs = sig.params.map((p) =>
        p.name === param.name ? value : happyValueForType(p.type, p.name)
      );
      const label = value === null ? 'null' : value === undefined ? 'undefined' : String(value);
      cases.push({
        strategy: 'boundary',
        description: `handles ${param.name}=${label}`,
        inputs,
        expectation: { type: 'return' },
      });
    }
  }

  return cases;
}

function generateHappyPath(sig: FunctionSignature): TestCase[] {
  const inputs = sig.params.map((p) => happyValueForType(p.type, p.name));
  return [
    {
      strategy: 'happy-path',
      description: 'returns a defined value for valid inputs',
      inputs,
      expectation: { type: 'return', pattern: 'defined' },
    },
  ];
}

function generateErrorPath(sig: FunctionSignature): TestCase[] {
  const cases: TestCase[] = [];

  // All-null call
  const allNull = sig.params.map(() => null);
  cases.push({
    strategy: 'error-path',
    description: 'handles all-null arguments without crashing',
    inputs: allNull,
    expectation: { type: 'return' },
  });

  // All-undefined call
  const allUndefined = sig.params.map(() => undefined);
  cases.push({
    strategy: 'error-path',
    description: 'handles all-undefined arguments without crashing',
    inputs: allUndefined,
    expectation: { type: 'return' },
  });

  return cases;
}

function generateBehavioralMirror(sig: FunctionSignature): TestCase[] {
  const cases: TestCase[] = [];
  const name = sig.name.toLowerCase();
  const ret = sig.returnType.toLowerCase();

  // Idempotency: f(f(x)) === f(x) for pure transforms
  if (name.includes('format') || name.includes('normalize') || name.includes('sanitize') || name.includes('trim')) {
    const inputs = sig.params.map((p) => happyValueForType(p.type, p.name));
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'is idempotent: applying twice gives same result as once',
      inputs,
      expectation: { type: 'property', pattern: 'idempotent' },
    });
  }

  // Commutativity: f(a, b) === f(b, a)
  if (
    sig.params.length === 2 &&
    sig.params[0] !== undefined &&
    sig.params[1] !== undefined &&
    sig.params[0].type === sig.params[1].type &&
    (name.includes('add') || name.includes('sum') || name.includes('merge') || name.includes('combine'))
  ) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'is commutative: f(a,b) === f(b,a)',
      inputs: sig.params.map((p) => happyValueForType(p.type, p.name)),
      expectation: { type: 'property', pattern: 'commutative' },
    });
  }

  // Non-negative numeric return
  if (
    (ret.includes('number') || ret === 'unknown') &&
    (name.includes('count') || name.includes('length') || name.includes('size') || name.includes('total'))
  ) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a non-negative number',
      inputs: sig.params.map((p) => happyValueForType(p.type, p.name)),
      expectation: { type: 'property', pattern: 'non-negative' },
    });
  }

  // Length-preserving for array operations
  if (
    sig.params.some((p) => p.type.includes('[]')) &&
    (name.includes('sort') || name.includes('shuffle') || name.includes('reverse') || name.includes('map'))
  ) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'output has same length as input array',
      inputs: sig.params.map((p) => happyValueForType(p.type, p.name)),
      expectation: { type: 'property', pattern: 'length-preserving' },
    });
  }

  // Fallback: always returns defined
  if (cases.length === 0) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'always returns a defined value for valid inputs',
      inputs: sig.params.map((p) => happyValueForType(p.type, p.name)),
      expectation: { type: 'property', pattern: 'defined' },
    });
  }

  return cases;
}

export function generateTestPlan(sig: FunctionSignature, importPath: string): TestPlan {
  return {
    functionName: sig.name,
    importPath,
    cases: [
      ...generateBoundaryCases(sig),
      ...generateHappyPath(sig),
      ...generateErrorPath(sig),
      ...generateBehavioralMirror(sig),
    ],
  };
}
