import type {
  FunctionParam,
  FunctionSignature,
  InvalidInputStrategy,
  TestCase,
  TestPlan,
} from './types.js';

const codeExpressionBrand = '__testgenExpression';

export interface CodeExpression {
  __testgenExpression: string;
}

export function isCodeExpression(value: unknown): value is CodeExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    codeExpressionBrand in value &&
    typeof (value as Record<string, unknown>)[codeExpressionBrand] === 'string'
  );
}

export function codeExpression(expression: string): CodeExpression {
  return { [codeExpressionBrand]: expression };
}

function boundaryValuesForType(type: string): unknown[] {
  const t = type.toLowerCase().replace(/\s/g, '');
  const unique = (values: unknown[]) => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const key =
        typeof value === 'number' && Number.isNaN(value)
          ? 'number:NaN'
          : `${typeof value}:${String(value)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  if (t.includes('[]') || t.includes('array')) {
    return unique([[], [null], [undefined], null, undefined]);
  }
  if (t.includes('{}') || t.includes('object') || t.includes('record') || t.startsWith('{')) {
    return unique([{}, { key: null }, null, undefined]);
  }
  if (t.includes('string')) {
    return unique(['', ' ', 'a', 'a'.repeat(1000), null, undefined]);
  }
  if (t.includes('number')) {
    return unique([0, -0, -1, 1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, null, undefined]);
  }
  if (t.includes('boolean')) {
    return unique([true, false, null, undefined]);
  }
  // unknown / any — probe a spread
  return unique([null, undefined, '', 0, [], {}]);
}

function happyValueForType(type: string, paramName: string): unknown {
  const t = type.toLowerCase().replace(/\s/g, '');
  const n = paramName.toLowerCase();

  if (/\bdate\b/i.test(type)) return codeExpression('new Date("2024-01-02T00:00:00.000Z")');
  if (/\berror\b/i.test(type)) return codeExpression('new Error("test error")');
  if (t.includes('[]') || t.includes('array')) return [1, 2, 3];
  const objectFixture = fixtureForObjectType(type);
  if (objectFixture !== undefined) return objectFixture;
  const domainFixture = fixtureForDomainType(type, paramName);
  if (domainFixture !== undefined) return domainFixture;
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
  return {};
}

function happyValueForParam(param: FunctionParam): unknown {
  if (param.fixtureValue !== undefined) return param.fixtureValue;
  return happyValueForType(param.type, param.name);
}

function splitTopLevel(raw: string, separators: string[]): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | undefined;
  let depth = 0;

  for (const char of raw) {
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '<' || char === '[' || char === '{' || char === '(') depth += 1;
    if (char === '>' || char === ']' || char === '}' || char === ')') depth -= 1;

    if (depth === 0 && separators.includes(char)) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function fixtureForObjectType(type: string): Record<string, unknown> | undefined {
  const trimmed = type.trim();
  if (/^Record\s*</.test(trimmed)) return { key: 'value' };
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;

  const body = trimmed.slice(1, -1).trim();
  if (!body) return {};
  const fixture: Record<string, unknown> = {};

  for (const field of splitTopLevel(body, [';', ','])) {
    const match = field.match(/^([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/);
    if (!match) continue;
    const [, name, , fieldType] = match;
    if (!name || !fieldType) continue;
    fixture[name] = happyValueForType(fieldType, name);
  }

  return Object.keys(fixture).length > 0 ? fixture : {};
}

function fixtureForDomainType(type: string, paramName: string): Record<string, unknown> | undefined {
  const hint = `${type} ${paramName}`.toLowerCase();

  if (/(user|customer|account|profile|member|author|owner)/.test(hint)) {
    return {
      id: 'user-123',
      name: 'Alice',
      email: 'alice@example.com',
    };
  }

  if (/(order|invoice|payment|checkout|subscription)/.test(hint)) {
    return {
      id: 'order-123',
      total: 42,
      status: 'paid',
    };
  }

  if (/(product|item|sku|catalog)/.test(hint)) {
    return {
      id: 'product-123',
      name: 'Widget',
      price: 42,
    };
  }

  if (/(config|options|settings|preferences)/.test(hint)) {
    return {
      enabled: true,
      retries: 3,
      mode: 'test',
    };
  }

  if (/(request|response|route|endpoint)/.test(hint)) {
    return {
      id: 'request-123',
      method: 'GET',
      url: 'https://example.com',
    };
  }

  if (/(event|message|notification|log)/.test(hint)) {
    return {
      id: 'event-123',
      type: 'test',
      timestamp: '2024-01-02T00:00:00.000Z',
    };
  }

  return undefined;
}

function splitArgs(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: string | undefined;
  let depth = 0;

  for (const char of raw) {
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '[' || char === '{' || char === '(') depth += 1;
    if (char === ']' || char === '}' || char === ')') depth -= 1;

    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function parseLiteral(raw: string): unknown {
  const value = raw.trim().replace(/[;.]$/, '');
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value === 'undefined') return undefined;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith('[') || value.startsWith('{')) {
    try {
      return JSON.parse(value.replace(/'/g, '"'));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function exampleFromJsdoc(sig: FunctionSignature): TestCase | undefined {
  if (!sig.jsdoc) return undefined;
  const escapedName = sig.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exampleRegex = new RegExp(`${escapedName}\\s*\\(([^)]*)\\)\\s*(?://|=>|=+>)\\s*([^\\n\\r*]+)`);
  const match = sig.jsdoc.match(exampleRegex);
  if (!match) return undefined;

  const inputs = splitArgs(match[1] ?? '').map(parseLiteral);
  if (inputs.length !== sig.params.length) return undefined;
  const value = parseLiteral(match[2] ?? '');
  if (value === undefined) return undefined;

  return {
    strategy: 'happy-path',
    description: 'matches documented example',
    inputs,
    expectation: { type: 'return', value },
  };
}

function generateBoundaryCases(sig: FunctionSignature): TestCase[] {
  const cases: TestCase[] = [];

  for (const param of sig.params) {
    for (const value of boundaryValuesForType(param.type)) {
      const inputs = sig.params.map((p) =>
        p.name === param.name ? value : happyValueForParam(p)
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
  const example = exampleFromJsdoc(sig);
  if (example) return [example];

  const inputs = sig.params.map(happyValueForParam);
  if (sig.literalReturnValue !== undefined) {
    return [
      {
        strategy: 'happy-path',
        description: 'returns the implementation literal for valid inputs',
        inputs,
        expectation: { type: 'return', value: sig.literalReturnValue },
      },
    ];
  }

  return [
    {
      strategy: 'happy-path',
      description: 'returns a defined value for valid inputs',
      inputs,
      expectation: { type: 'return', pattern: 'defined' },
    },
  ];
}

function generateErrorPath(
  sig: FunctionSignature,
  invalidInputStrategy: InvalidInputStrategy
): TestCase[] {
  if (invalidInputStrategy === 'skip') return [];
  const cases: TestCase[] = [];
  const expectation = {
    type: invalidInputStrategy === 'throw' ? 'throw' as const : 'return' as const,
  };

  // All-null call
  const allNull = sig.params.map(() => null);
  cases.push({
    strategy: 'error-path',
    description:
      invalidInputStrategy === 'throw'
        ? 'throws for all-null arguments'
        : 'handles all-null arguments without crashing',
    inputs: allNull,
    expectation,
  });

  // All-undefined call
  const allUndefined = sig.params.map(() => undefined);
  cases.push({
    strategy: 'error-path',
    description:
      invalidInputStrategy === 'throw'
        ? 'throws for all-undefined arguments'
        : 'handles all-undefined arguments without crashing',
    inputs: allUndefined,
    expectation,
  });

  return cases;
}

function generateBehavioralMirror(sig: FunctionSignature): TestCase[] {
  const cases: TestCase[] = [];
  const name = sig.name.toLowerCase();
  const ret = sig.returnType.toLowerCase();
  const arrayParamIndex = sig.params.findIndex((p) => p.type.includes('[]') || p.type.toLowerCase().includes('array'));
  const hasArrayParam = arrayParamIndex !== -1;
  const firstParam = sig.params[0];
  const normalizedReturn = sig.returnType.toLowerCase().replace(/\s/g, '');
  const normalizedFirstParam = firstParam?.type.toLowerCase().replace(/\s/g, '');

  const inputsForBehavior = (overrides: Record<number, unknown> = {}) =>
    sig.params.map((p, index) =>
      Object.prototype.hasOwnProperty.call(overrides, index)
        ? overrides[index]
        : happyValueForParam(p)
    );

  if (name.includes('clamp') && sig.params.length >= 3) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a value within [min, max] when min <= max',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'clamp-range' },
    });
  }

  // Idempotency: f(f(x)) === f(x) only when the output can safely feed the input.
  if (
    normalizedFirstParam === normalizedReturn &&
    (name.includes('normalize') || name.includes('sanitize') || name.includes('trim'))
  ) {
    const inputs = inputsForBehavior();
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
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'commutative' },
    });
  }

  if (
    ret.includes('boolean') ||
    name.startsWith('is') ||
    name.startsWith('has') ||
    name.startsWith('can') ||
    name.startsWith('should') ||
    name.includes('validate')
  ) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a boolean result',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'boolean-return' },
    });
  }

  if (name.includes('parse')) {
    const pattern =
      ret.includes('date') ? 'date-return' :
      ret.includes('object') || ret.includes('{') || ret.includes('record') ? 'object-return' :
      ret.includes('number') ? 'number-return' :
      ret.includes('string') ? 'string-return' :
      ret.includes('boolean') ? 'boolean-return' :
      'defined';
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a parsed value with the expected shape',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern },
    });
  }

  if (ret.includes('date') || /^parse.*date/.test(name) || /^to.*date/.test(name) || /^create.*date/.test(name)) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a Date value',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'date-return' },
    });
  }

  if (name.startsWith('get')) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a defined value for an existing lookup',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'defined' },
    });
  }

  if (
    (name.startsWith('create') || name.startsWith('build') || name.startsWith('make')) &&
    (ret.includes('object') || ret.includes('{') || /^[A-Z]/.test(sig.returnType))
  ) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a created object result',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'object-return' },
    });
  }

  if (name.includes('serialize') || name.includes('tostring') || name.startsWith('format')) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a string representation',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'string-return' },
    });
  }

  if (name.includes('json') && ret.includes('string')) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns parseable JSON text',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'json-string' },
    });
  }

  if ((name.includes('email') || ret.includes('email')) && ret.includes('string')) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns an email-shaped string',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'email-string' },
    });
  }

  if ((name.includes('url') || name.includes('uri')) && ret.includes('string')) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a URL-shaped string',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'url-string' },
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
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'non-negative' },
    });
  }

  if (
    ret.includes('number') &&
    (name.includes('calculate') || name.includes('compute') || name.includes('score') || name.includes('price'))
  ) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a finite number',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'number-return' },
    });
  }

  if (hasArrayParam && name.includes('unique')) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns unique array values',
      inputs: inputsForBehavior({ [arrayParamIndex]: [1, 1, 2, 2, 3] }),
      expectation: { type: 'property', pattern: 'unique-values' },
    });
  }

  if (hasArrayParam && (name.includes('min') || name.includes('minimum'))) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a value no greater than the minimum input',
      inputs: inputsForBehavior({ [arrayParamIndex]: [3, 1, 2] }),
      expectation: { type: 'property', pattern: 'min-bound' },
    });
  }

  if (hasArrayParam && (name.includes('max') || name.includes('maximum'))) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a value no less than the maximum input',
      inputs: inputsForBehavior({ [arrayParamIndex]: [3, 1, 2] }),
      expectation: { type: 'property', pattern: 'max-bound' },
    });
  }

  if (hasArrayParam && (name.includes('average') || name.includes('avg') || name.includes('mean'))) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns a value between the minimum and maximum input',
      inputs: inputsForBehavior({ [arrayParamIndex]: [3, 1, 2] }),
      expectation: { type: 'property', pattern: 'average-bound' },
    });
  }

  if (name.includes('groupby') || name.includes('group-by') || name.includes('group')) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns an object grouping result',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'object-return' },
    });
  }

  if (
    ret.includes('[]') ||
    ret.includes('array') ||
    name.startsWith('list') ||
    name.startsWith('find') ||
    name.startsWith('search')
  ) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'returns an array result',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'array-return' },
    });
  }

  // Length-preserving for array operations
  if (hasArrayParam) {
    if (name.includes('filter')) {
      cases.push({
        strategy: 'behavioral-mirror',
        description: 'output length is less than or equal to input array length',
        inputs: inputsForBehavior(),
        expectation: { type: 'property', pattern: 'length-upper-bound' },
      });
    } else if (name.includes('sort') || name.includes('shuffle') || name.includes('reverse') || name.includes('map')) {
      cases.push({
        strategy: 'behavioral-mirror',
        description: 'output has same length as input array',
        inputs: inputsForBehavior(),
        expectation: { type: 'property', pattern: 'length-preserving' },
      });
    }
  }

  // Fallback: always returns defined
  if (cases.length === 0) {
    cases.push({
      strategy: 'behavioral-mirror',
      description: 'always returns a defined value for valid inputs',
      inputs: inputsForBehavior(),
      expectation: { type: 'property', pattern: 'defined' },
    });
  }

  return cases;
}

export function generateTestPlan(
  sig: FunctionSignature,
  importPath: string,
  options: { invalidInputStrategy?: InvalidInputStrategy } = {}
): TestPlan {
  const invalidInputStrategy = options.invalidInputStrategy ?? 'no-throw';
  return {
    functionName: sig.name,
    importPath,
    cases: [
      ...generateBoundaryCases(sig),
      ...generateHappyPath(sig),
      ...generateErrorPath(sig, invalidInputStrategy),
      ...generateBehavioralMirror(sig),
    ],
  };
}
