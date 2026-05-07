import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, mergeOptions } from './config.js';

describe('config', () => {
  it('loads .testgenrc and merges defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'testgen-config-'));
    writeFileSync(
      join(dir, '.testgenrc'),
      JSON.stringify({
        testDir: '__generated_tests__',
        invalidInputStrategy: 'throw',
        exclude: ['**/*.generated.ts'],
        merge: true,
        extractor: 'typescript',
      })
    );

    const loaded = loadConfig(dir);
    const options = mergeOptions(loaded.config, {}, loaded.configDir);

    expect(options.testDir).toBe('__generated_tests__');
    expect(options.invalidInputStrategy).toBe('throw');
    expect(options.exclude).toEqual(['**/*.generated.ts']);
    expect(options.merge).toBe(true);
    expect(options.extractor).toBe('typescript');
  });
});
