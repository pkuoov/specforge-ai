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
});
