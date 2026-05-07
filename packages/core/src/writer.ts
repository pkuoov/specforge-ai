import type { FunctionSignature, TestCase, TestPlan } from './types.js';

function formatInput(value: unknown): string {
  if (value === undefined) return 'undefined as any';
  if (value === null) return 'null as any';
  if (Array.isArray(value)) return `[${value.map(formatInput).join(', ')}]`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
    return String(value);
  }
  return JSON.stringify(value);
}

function renderExpectation(
  fnCall: string,
  expectation: TestCase['expectation'],
  sig: FunctionSignature
): string {
  const asyncPrefix = sig.isAsync ? 'await ' : '';
  const call = `${asyncPrefix}${fnCall}`;

  switch (expectation.type) {
    case 'throw':
      return `    expect(${sig.isAsync ? 'async ' : ''}() => ${call}).${sig.isAsync ? 'rejects.toThrow' : 'toThrow'}();`;

    case 'return':
      if (expectation.value !== undefined) {
        return `    expect(${call}).toEqual(${formatInput(expectation.value)});`;
      }
      return `    expect(${call}).toBeDefined();`;

    case 'property':
      switch (expectation.pattern) {
        case 'defined':
          return `    expect(${call}).toBeDefined();`;
        case 'non-negative':
          return `    expect(${call}).toBeGreaterThanOrEqual(0);`;
        case 'length-preserving':
          return `    expect(Array.isArray(${call})).toBe(true);`;
        default:
          return `    expect(${call}).toBeDefined();`;
      }

    default:
      return `    expect(${call}).toBeDefined();`;
  }
}

function renderPropertyExpectation(tc: TestCase, sig: FunctionSignature): string | undefined {
  const args = tc.inputs.map(formatInput);
  const asyncPrefix = sig.isAsync ? 'await ' : '';
  const callTarget = sig.callExpression ?? sig.name;
  const call = `${asyncPrefix}${callTarget}(${args.join(', ')})`;

  switch (tc.expectation.pattern) {
    case 'idempotent':
      if (args.length !== 1) return undefined;
      return [
        `    const once = ${call};`,
        `    const twice = ${asyncPrefix}${callTarget}(once as any);`,
        `    expect(twice).toEqual(once);`,
      ].join('\n');

    case 'commutative':
      if (args.length !== 2) return undefined;
      return [
        `    const ab = ${call};`,
        `    const ba = ${asyncPrefix}${callTarget}(${args[1]}, ${args[0]});`,
        `    expect(ba).toEqual(ab);`,
      ].join('\n');

    case 'length-preserving':
    case 'length-upper-bound': {
      const arrayArgIndex = tc.inputs.findIndex((value) => Array.isArray(value));
      const arrayArg = args[arrayArgIndex];
      if (arrayArgIndex === -1 || !arrayArg) return undefined;
      const comparator =
        tc.expectation.pattern === 'length-upper-bound'
          ? `toBeLessThanOrEqual((${arrayArg}).length)`
          : `toBe((${arrayArg}).length)`;
      return [
        `    const result = ${call};`,
        `    expect(Array.isArray(result)).toBe(true);`,
        `    expect((result as unknown[]).length).${comparator};`,
      ].join('\n');
    }

    case 'clamp-range':
      if (args.length < 3) return undefined;
      return [
        `    const result = ${call};`,
        `    expect(typeof result).toBe('number');`,
        `    expect(result).toBeGreaterThanOrEqual(${args[1]});`,
        `    expect(result).toBeLessThanOrEqual(${args[2]});`,
      ].join('\n');

    case 'boolean-return':
      return [
        `    const result = ${call};`,
        `    expect(typeof result).toBe('boolean');`,
      ].join('\n');

    case 'object-return':
      return [
        `    const result = ${call};`,
        `    expect(result).toBeTruthy();`,
        `    expect(typeof result).toBe('object');`,
        `    expect(Array.isArray(result)).toBe(false);`,
      ].join('\n');

    case 'unique-values': {
      const arrayArgIndex = tc.inputs.findIndex((value) => Array.isArray(value));
      const arrayArg = args[arrayArgIndex];
      if (arrayArgIndex === -1 || !arrayArg) return undefined;
      return [
        `    const result = ${call};`,
        `    expect(Array.isArray(result)).toBe(true);`,
        `    expect((result as unknown[]).length).toBeLessThanOrEqual((${arrayArg}).length);`,
        `    expect(new Set(result as unknown[]).size).toBe((result as unknown[]).length);`,
      ].join('\n');
    }

    case 'min-bound':
    case 'max-bound':
    case 'average-bound': {
      const arrayArgIndex = tc.inputs.findIndex((value) => Array.isArray(value));
      const arrayArg = args[arrayArgIndex];
      if (arrayArgIndex === -1 || !arrayArg) return undefined;
      const resultChecks =
        tc.expectation.pattern === 'min-bound'
          ? [
              `    expect(values.every((value) => result <= value)).toBe(true);`,
              `    expect(values).toContain(result);`,
            ]
          : tc.expectation.pattern === 'max-bound'
            ? [
                `    expect(values.every((value) => result >= value)).toBe(true);`,
                `    expect(values).toContain(result);`,
              ]
            : [
                `    expect(result).toBeGreaterThanOrEqual(Math.min(...values));`,
                `    expect(result).toBeLessThanOrEqual(Math.max(...values));`,
              ];
      return [
        `    const values = ${arrayArg};`,
        `    const result = ${call};`,
        `    expect(typeof result).toBe('number');`,
        ...resultChecks,
      ].join('\n');
    }

    default:
      return undefined;
  }
}

function renderBoundaryExpectation(fnCall: string, sig: FunctionSignature): string {
  if (sig.isAsync) {
    return `    await expect(${fnCall}).resolves.toBeDefined();`;
  }
  return `    expect(() => ${fnCall}).not.toThrow();`;
}

function renderTestCase(tc: TestCase, sig: FunctionSignature): string {
  const args = tc.inputs.map(formatInput).join(', ');
  const fnCall = `${sig.callExpression ?? sig.name}(${args})`;
  const propertyBody =
    tc.expectation.type === 'property' ? renderPropertyExpectation(tc, sig) : undefined;
  const body =
    propertyBody
      ? propertyBody
      : tc.expectation.type === 'throw'
      ? renderExpectation(fnCall, tc.expectation, sig)
      : tc.strategy === 'boundary' || tc.strategy === 'error-path'
      ? renderBoundaryExpectation(fnCall, sig)
      : renderExpectation(fnCall, tc.expectation, sig);

  const itFn = sig.isAsync ? 'it' : 'it';
  return [
    `  ${itFn}(${JSON.stringify(tc.description)}, ${sig.isAsync ? 'async ' : ''}() => {`,
    body,
    `  });`,
  ].join('\n');
}

function groupByStrategy(cases: TestCase[]): Map<TestCase['strategy'], TestCase[]> {
  const groups = new Map<TestCase['strategy'], TestCase[]>();
  for (const tc of cases) {
    const list = groups.get(tc.strategy) ?? [];
    list.push(tc);
    groups.set(tc.strategy, list);
  }
  return groups;
}

function renderFunctionBlock(plan: TestPlan, sig: FunctionSignature): string {
  const groups = groupByStrategy(plan.cases);
  const sections: string[] = [];

  const labels: Record<TestCase['strategy'], string> = {
    'boundary': 'boundary cases',
    'happy-path': 'happy path',
    'error-path': 'error path',
    'behavioral-mirror': 'behavioral contracts',
  };

  for (const [strategy, cases] of groups) {
    const rendered = cases.map((tc) => renderTestCase(tc, sig)).join('\n\n');
    sections.push([
      `  describe(${JSON.stringify(labels[strategy])}, () => {`,
      rendered,
      `  });`,
    ].join('\n'));
  }

  return [
    `describe(${JSON.stringify(plan.functionName)}, () => {`,
    sections.join('\n\n'),
    `});`,
  ].join('\n');
}

export function renderTestFile(
  plans: TestPlan[],
  sigs: FunctionSignature[],
  importPath: string
): string {
  const sigMap = new Map(sigs.map((s) => [s.name, s]));
  const selectedSigs = plans
    .map((p) => sigMap.get(p.functionName))
    .filter((sig): sig is FunctionSignature => !!sig);
  const defaultImports = [...new Set(selectedSigs
    .filter((sig) => sig.exportKind === 'default')
    .map((sig) => sig.importName ?? sig.name))];
  const namedImports = [
    ...new Set(
      selectedSigs
        .filter((sig) => sig.exportKind !== 'default')
        .map((sig) => sig.importName ?? sig.name)
    ),
  ];

  const imports = [
    `import { describe, it, expect } from 'vitest';`,
    ...defaultImports.map((name) => `import ${name} from '${importPath}';`),
    namedImports.length > 0 ? `import { ${namedImports.join(', ')} } from '${importPath}';` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const blocks = plans
    .map((plan) => {
      const sig = sigMap.get(plan.functionName);
      return sig ? renderFunctionBlock(plan, sig) : '';
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    `// Generated by testgen — https://github.com/your-org/testgen`,
    `// DO NOT edit boundary/mirror cases by hand — regenerate with: npx testgen <file>`,
    `// Add project-specific assertions below each generated block.`,
    '',
    imports,
    '',
    blocks,
    '',
  ].join('\n');
}
