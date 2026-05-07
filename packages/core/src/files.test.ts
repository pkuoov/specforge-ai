import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandTargets } from './files.js';

describe('expandTargets', () => {
  it('expands directories and skips tests, declarations, and build output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'testgen-files-'));
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'src', 'math.ts'), 'export function add() {}\n');
    writeFileSync(join(dir, 'src', 'math.test.ts'), 'test("x", () => undefined)\n');
    writeFileSync(join(dir, 'src', 'types.d.ts'), 'export type X = string;\n');
    writeFileSync(join(dir, 'dist', 'built.ts'), 'export function built() {}\n');

    const targets = expandTargets(dir, {
      include: ['**/*.{ts,tsx,js,jsx}'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', '**/dist/**'],
      rootDir: dir,
    });

    expect(targets).toEqual([join(dir, 'src', 'math.ts')]);
  });
});
