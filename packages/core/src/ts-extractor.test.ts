import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFunctionsFromTypeScript } from './ts-extractor.js';

function writeTempSource(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'testgen-ts-extractor-'));
  const sourcePath = join(dir, 'source.ts');
  writeFileSync(sourcePath, source);
  return sourcePath;
}

describe('extractFunctionsFromTypeScript', () => {
  it('extracts default functions with default import metadata', async () => {
    const sourcePath = writeTempSource(
      'export default function clamp(value: number, min: number, max: number): number { return value; }\n'
    );

    const sigs = await extractFunctionsFromTypeScript(sourcePath);

    expect(sigs[0]).toMatchObject({
      name: 'clamp',
      importName: 'clamp',
      exportKind: 'default',
      returnType: 'number',
    });
  });

  it('extracts local export specifiers', async () => {
    const sourcePath = writeTempSource(
      'const isReady = (value: string): boolean => value.length > 0;\nexport { isReady };\n'
    );

    const sigs = await extractFunctionsFromTypeScript(sourcePath);

    expect(sigs.map((sig) => sig.name)).toEqual(['isReady']);
  });

  it('extracts simple literal return hints', async () => {
    const sourcePath = writeTempSource(
      'export function answer(): number { return 42; }\nexport const status = () => "ok";\n'
    );

    const sigs = await extractFunctionsFromTypeScript(sourcePath);

    expect(sigs.map((sig) => [sig.name, sig.literalReturnValue])).toEqual([
      ['answer', 42],
      ['status', 'ok'],
    ]);
  });

  it('extracts static class methods and object-exported functions', async () => {
    const sourcePath = writeTempSource(`
      export class Calculator {
        static add(a: number, b: number): number { return a + b; }
      }

      export const math = {
        double(value: number): number { return value * 2; },
        triple: (value: number): number => value * 3
      };
    `);

    const sigs = await extractFunctionsFromTypeScript(sourcePath);

    expect(sigs.map((sig) => sig.name)).toEqual([
      'Calculator.add',
      'math.double',
      'math.triple',
    ]);
    expect(sigs.map((sig) => sig.importName)).toEqual(['Calculator', 'math', 'math']);
    expect(sigs.map((sig) => sig.callExpression)).toEqual([
      'Calculator.add',
      'math.double',
      'math.triple',
    ]);
  });

  it('extracts default class static methods and namespace functions', async () => {
    const sourcePath = writeTempSource(`
      export default class Calculator {
        static add(a: number, b: number): number { return a + b; }
      }

      export namespace strings {
        export function normalize(input: string): string { return input.trim(); }
      }
    `);

    const sigs = await extractFunctionsFromTypeScript(sourcePath);

    expect(sigs.map((sig) => sig.name)).toEqual([
      'Calculator.add',
      'strings.normalize',
    ]);
    expect(sigs.map((sig) => sig.importName)).toEqual(['Calculator', 'strings']);
    expect(sigs.map((sig) => sig.exportKind)).toEqual(['default', 'named']);
    expect(sigs.map((sig) => sig.callExpression)).toEqual([
      'Calculator.add',
      'strings.normalize',
    ]);
  });

  it('extracts named cross-file re-exports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'testgen-ts-extractor-'));
    const mathPath = join(dir, 'math.ts');
    const indexPath = join(dir, 'index.ts');
    writeFileSync(mathPath, `
      export function add(a: number, b: number): number { return a + b; }
      export class Calculator {
        static max(values: number[]): number { return Math.max(...values); }
      }
    `);
    writeFileSync(indexPath, "export { add as sum, Calculator as Calc } from './math';\n");

    const sigs = await extractFunctionsFromTypeScript(indexPath);

    expect(sigs.map((sig) => sig.name)).toEqual(['sum', 'Calc.max']);
    expect(sigs.map((sig) => sig.importName)).toEqual(['sum', 'Calc']);
    expect(sigs.map((sig) => sig.callExpression)).toEqual(['sum', 'Calc.max']);
  });

  it('extracts namespace cross-file re-exports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'testgen-ts-extractor-'));
    const mathPath = join(dir, 'math.ts');
    const indexPath = join(dir, 'index.ts');
    writeFileSync(mathPath, `
      export function add(a: number, b: number): number { return a + b; }
      export class Calculator {
        static max(values: number[]): number { return Math.max(...values); }
      }
    `);
    writeFileSync(indexPath, "export * as math from './math';\n");

    const sigs = await extractFunctionsFromTypeScript(indexPath);

    expect(sigs.map((sig) => sig.name)).toEqual(['math.add', 'math.Calculator.max']);
    expect(sigs.map((sig) => sig.importName)).toEqual(['math', 'math']);
    expect(sigs.map((sig) => sig.callExpression)).toEqual(['math.add', 'math.Calculator.max']);
  });

  it('extracts top-level overload signatures as separate cases', async () => {
    const sourcePath = writeTempSource(`
      export function parseValue(value: string): number;
      export function parseValue(value: number): number;
      export function parseValue(value: string | number): number {
        return Number(value);
      }
    `);

    const sigs = await extractFunctionsFromTypeScript(sourcePath);

    expect(sigs.map((sig) => sig.name)).toEqual([
      'parseValue overload 1',
      'parseValue overload 2',
    ]);
    expect(sigs.map((sig) => sig.callExpression)).toEqual(['parseValue', 'parseValue']);
    expect(sigs.map((sig) => sig.params[0]?.type)).toEqual(['string', 'number']);
    expect(sigs.map((sig) => sig.overloadIndex)).toEqual([1, 2]);
  });

  it('extracts fixture values from local interface and type fields', async () => {
    const sourcePath = writeTempSource(`
      interface User {
        id: string;
        email: string;
        active: boolean;
        profile: {
          name: string;
          visitCount: number;
        };
      }

      type Options = {
        retries: number;
        enabled: boolean;
      };

      export function summarizeUser(user: User, options: Options): string {
        return user.email;
      }
    `);

    const sigs = await extractFunctionsFromTypeScript(sourcePath);

    expect(sigs[0]?.params[0]?.fixtureValue).toEqual({
      id: 'abc-123',
      email: 'alice@example.com',
      active: true,
      profile: {
        name: 'Alice',
        visitCount: 5,
      },
    });
    expect(sigs[0]?.params[1]?.fixtureValue).toEqual({
      retries: 42,
      enabled: true,
    });
  });

  it('extracts class static overload signatures as separate cases', async () => {
    const sourcePath = writeTempSource(`
      export class Parser {
        static parse(value: string): number;
        static parse(value: number): number;
        static parse(value: string | number): number {
          return Number(value);
        }
      }
    `);

    const sigs = await extractFunctionsFromTypeScript(sourcePath);

    expect(sigs.map((sig) => sig.name)).toEqual([
      'Parser.parse overload 1',
      'Parser.parse overload 2',
    ]);
    expect(sigs.map((sig) => sig.callExpression)).toEqual(['Parser.parse', 'Parser.parse']);
    expect(sigs.map((sig) => sig.params[0]?.type)).toEqual(['string', 'number']);
  });
});
