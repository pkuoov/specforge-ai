import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runTestgen } from './index.js';

function createTempSource(): string {
  const dir = mkdtempSync(join(tmpdir(), 'testgen-core-'));
  const sourcePath = join(dir, 'math.ts');
  writeFileSync(sourcePath, 'export function add(a: number, b: number): number { return a + b; }\n');
  return sourcePath;
}

describe('runTestgen', () => {
  it('does not report dry-run cases as passed', async () => {
    const sourcePath = createTempSource();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const report = await runTestgen(sourcePath, { dryRun: true });

    expect(report.totalPassed).toBe(0);
    expect(report.totalFailed).toBe(0);
    log.mockRestore();
  });

  it('refuses to overwrite an existing test unless explicitly requested', async () => {
    const sourcePath = createTempSource();
    writeFileSync(sourcePath.replace(/\.ts$/, '.test.ts'), '// existing test\n');

    await expect(runTestgen(sourcePath, { runAfterWrite: false })).rejects.toThrow(
      /refusing to overwrite/
    );
  });

  it('allows dry-run previews when a test file already exists', async () => {
    const sourcePath = createTempSource();
    writeFileSync(sourcePath.replace(/\.ts$/, '.test.ts'), '// existing test\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(runTestgen(sourcePath, { dryRun: true })).resolves.toMatchObject({
      totalPassed: 0,
      totalFailed: 0,
    });
    expect(log.mock.calls.flat().join('\n')).toContain('testgen (dry-run): would write');
    log.mockRestore();
  });

  it('merges generated tests into an existing file without deleting manual tests', async () => {
    const sourcePath = createTempSource();
    const testPath = sourcePath.replace(/\.ts$/, '.test.ts');
    writeFileSync(
      testPath,
      "import { describe, it, expect } from 'vitest';\n\nit('manual behavior stays', () => expect(true).toBe(true));\n"
    );

    await runTestgen(sourcePath, { merge: true, runAfterWrite: false });

    const output = readFileSync(testPath, 'utf-8');
    expect(output).toContain("it('manual behavior stays'");
    expect(output).toContain('// <testgen:generated>');
    expect(output).toContain('describe("add"');
  });

  it('writes generated markers when merge mode creates a new file', async () => {
    const sourcePath = createTempSource();

    await runTestgen(sourcePath, { merge: true, runAfterWrite: false });

    const output = readFileSync(sourcePath.replace(/\.ts$/, '.test.ts'), 'utf-8');
    expect(output.trimStart().startsWith('// <testgen:generated>')).toBe(true);
    expect(output.trimEnd().endsWith('// </testgen:generated>')).toBe(true);
  });

  it('uses TypeScript AST extraction in auto mode before falling back to regex', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'testgen-core-'));
    const sourcePath = join(dir, 'fn-expression.ts');
    writeFileSync(
      sourcePath,
      'export const double = function(value: number): number { return value * 2; }\n'
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runTestgen(sourcePath, { dryRun: true, extractor: 'auto' });

    expect(log.mock.calls.flat().join('\n')).toContain('describe("double"');
    log.mockRestore();
  });
});
