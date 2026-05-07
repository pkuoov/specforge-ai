import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { TestgenConfig, TestgenOptions } from './types.js';

const CONFIG_FILES = ['.testgenrc', '.testgenrc.json', 'testgen.config.json'];

export interface LoadedConfig {
  config: TestgenConfig;
  configDir: string;
  path?: string;
}

function findConfigPath(startDir: string): string | undefined {
  let dir = resolve(startDir);
  while (true) {
    for (const name of CONFIG_FILES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function readJsonConfig(path: string): TestgenConfig {
  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as TestgenConfig;
}

export function loadConfig(startDir = process.cwd()): LoadedConfig {
  const path = findConfigPath(startDir);
  if (!path) return { config: {}, configDir: resolve(startDir) };
  return {
    config: readJsonConfig(path),
    configDir: dirname(path),
    path,
  };
}

export function mergeOptions(
  config: TestgenConfig,
  options: Partial<TestgenOptions> = {},
  configDir?: string
): TestgenOptions {
  return {
    auto: false,
    silentIfTested: false,
    dryRun: false,
    overwrite: false,
    merge: config.merge ?? false,
    runAfterWrite: true,
    runner: config.runner ?? 'vitest',
    extractor: config.extractor ?? 'auto',
    testDir: config.testDir,
    configDir,
    include: config.include ?? ['**/*.{ts,tsx,js,jsx}'],
    exclude: config.exclude ?? [
      '**/*.test.*',
      '**/*.spec.*',
      '**/*.d.ts',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
    ],
    invalidInputStrategy: config.invalidInputStrategy ?? 'no-throw',
    ...options,
  };
}
