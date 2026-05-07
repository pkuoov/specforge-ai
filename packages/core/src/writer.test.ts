import { describe, expect, it } from 'vitest';
import { generateTestPlan } from './generator.js';
import { renderTestFile } from './writer.js';
import type { FunctionSignature } from './types.js';

describe('renderTestFile', () => {
  it('does not swallow boundary or error-path failures', () => {
    const sig: FunctionSignature = {
      name: 'normalizeString',
      params: [{ name: 'input', type: 'string', optional: false }],
      returnType: 'string',
      isAsync: false,
      isExported: true,
    };
    const plan = generateTestPlan(sig, './normalize-string');
    const source = renderTestFile([plan], [sig], './normalize-string');

    expect(source).not.toContain('try {');
    expect(source).not.toContain('Throwing is acceptable');
    expect(source).toContain('expect(() => normalizeString(null as any)).not.toThrow()');
  });

  it('renders real behavioral contract assertions', () => {
    const sig: FunctionSignature = {
      name: 'add',
      params: [
        { name: 'a', type: 'number', optional: false },
        { name: 'b', type: 'number', optional: false },
      ],
      returnType: 'number',
      isAsync: false,
      isExported: true,
    };
    const plan = generateTestPlan(sig, './math');
    const source = renderTestFile([plan], [sig], './math');

    expect(source).toContain('const ab = add(42, 42);');
    expect(source).toContain('const ba = add(42, 42);');
    expect(source).toContain('expect(ba).toEqual(ab);');
  });

  it('can render invalid-input tests as throw assertions', () => {
    const sig: FunctionSignature = {
      name: 'parseCount',
      params: [{ name: 'value', type: 'string', optional: false }],
      returnType: 'number',
      isAsync: false,
      isExported: true,
    };
    const plan = generateTestPlan(sig, './parse-count', { invalidInputStrategy: 'throw' });
    const source = renderTestFile([plan], [sig], './parse-count');

    expect(source).toContain('throws for all-null arguments');
    expect(source).toContain('expect(() => parseCount(null as any)).toThrow();');
  });

  it('renders imports and calls for default, static, and object-exported functions', () => {
    const sigs: FunctionSignature[] = [
      {
        name: 'clamp',
        importName: 'clamp',
        exportKind: 'default',
        params: [{ name: 'value', type: 'number', optional: false }],
        returnType: 'number',
        isAsync: false,
        isExported: true,
      },
      {
        name: 'Calculator.add',
        importName: 'Calculator',
        callExpression: 'Calculator.add',
        params: [
          { name: 'a', type: 'number', optional: false },
          { name: 'b', type: 'number', optional: false },
        ],
        returnType: 'number',
        isAsync: false,
        isExported: true,
      },
    ];
    const plans = sigs.map((sig) => generateTestPlan(sig, './math', { invalidInputStrategy: 'skip' }));
    const source = renderTestFile(plans, sigs, './math');

    expect(source).toContain("import clamp from './math';");
    expect(source).toContain("import { Calculator } from './math';");
    expect(source).toContain('Calculator.add(0, 42)');
  });

  it('renders expanded behavioral contract assertions', () => {
    const sig: FunctionSignature = {
      name: 'uniqueValues',
      params: [{ name: 'values', type: 'number[]', optional: false }],
      returnType: 'number[]',
      isAsync: false,
      isExported: true,
    };
    const plan = generateTestPlan(sig, './arrays');
    const source = renderTestFile([plan], [sig], './arrays');

    expect(source).toContain('returns unique array values');
    expect(source).toContain('expect(new Set(result as unknown[]).size).toBe((result as unknown[]).length);');
  });

  it('renders numeric bound contract assertions', () => {
    const sig: FunctionSignature = {
      name: 'minValue',
      params: [{ name: 'values', type: 'number[]', optional: false }],
      returnType: 'number',
      isAsync: false,
      isExported: true,
    };
    const plan = generateTestPlan(sig, './numbers');
    const source = renderTestFile([plan], [sig], './numbers');

    expect(source).toContain('returns a value no greater than the minimum input');
    expect(source).toContain('expect(values.every((value) => result <= value)).toBe(true);');
    expect(source).toContain('expect(values).toContain(result);');
  });

  it('uses documented examples as concrete happy-path expectations', () => {
    const sig: FunctionSignature = {
      name: 'add',
      params: [
        { name: 'a', type: 'number', optional: false },
        { name: 'b', type: 'number', optional: false },
      ],
      returnType: 'number',
      jsdoc: '/** @example add(1, 2) => 3 */',
      isAsync: false,
      isExported: true,
    };
    const plan = generateTestPlan(sig, './math');
    const source = renderTestFile([plan], [sig], './math');

    expect(source).toContain('matches documented example');
    expect(source).toContain('expect(add(1, 2)).toEqual(3);');
  });

  it('uses implementation literal hints as concrete happy-path expectations', () => {
    const sig: FunctionSignature = {
      name: 'answer',
      params: [],
      returnType: 'number',
      literalReturnValue: 42,
      isAsync: false,
      isExported: true,
    };
    const plan = generateTestPlan(sig, './answer');
    const source = renderTestFile([plan], [sig], './answer');

    expect(source).toContain('returns the implementation literal for valid inputs');
    expect(source).toContain('expect(answer()).toEqual(42);');
  });

  it('renders object fixtures and parse/get/date contracts', () => {
    const sigs: FunctionSignature[] = [
      {
        name: 'parseUser',
        params: [{ name: 'raw', type: 'string', optional: false }],
        returnType: '{ id: string; count: number }',
        isAsync: false,
        isExported: true,
      },
      {
        name: 'getUserName',
        params: [
          {
            name: 'user',
            type: '{ id: string; name: string; visits: number }',
            optional: false,
          },
        ],
        returnType: 'string',
        isAsync: false,
        isExported: true,
      },
      {
        name: 'parseDate',
        params: [{ name: 'input', type: 'string', optional: false }],
        returnType: 'Date',
        isAsync: false,
        isExported: true,
      },
    ];
    const plans = sigs.map((sig) => generateTestPlan(sig, './users', { invalidInputStrategy: 'skip' }));
    const source = renderTestFile(plans, sigs, './users');

    expect(source).toContain('expect(typeof result).toBe(\'object\');');
    expect(source).toContain('getUserName({ id: "abc-123", name: "Alice", visits: 42 })');
    expect(source).toContain('returns a defined value for an existing lookup');
    expect(source).toContain('expect(result instanceof Date).toBe(true);');
  });

  it('renders domain-shaped fixtures and Date inputs', () => {
    const sigs: FunctionSignature[] = [
      {
        name: 'createUserSummary',
        params: [{ name: 'user', type: 'User', optional: false }],
        returnType: 'UserSummary',
        isAsync: false,
        isExported: true,
      },
      {
        name: 'formatDate',
        params: [{ name: 'value', type: 'Date', optional: false }],
        returnType: 'string',
        isAsync: false,
        isExported: true,
      },
    ];
    const plans = sigs.map((sig) => generateTestPlan(sig, './domain', { invalidInputStrategy: 'skip' }));
    const source = renderTestFile(plans, sigs, './domain');

    expect(source).toContain('createUserSummary({ id: "user-123", name: "Alice", email: "alice@example.com" })');
    expect(source).toContain('returns a created object result');
    expect(source).toContain('formatDate(new Date("2024-01-02T00:00:00.000Z"))');
    expect(source).toContain('returns a string representation');
    expect(source).not.toContain('formatDate(once as any)');
    expect(source).not.toContain('expect(result instanceof Date).toBe(true);');
  });
});
