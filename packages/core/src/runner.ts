import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { classifyResult } from './reporter.js';
import type { FunctionReport, TestResult, TestStrategy } from './types.js';

interface VitestJsonResult {
  testResults?: Array<{
    testResults?: Array<{
      ancestorTitles?: string[];
      title?: string;
      status?: 'passed' | 'failed' | 'pending' | 'skipped';
      failureMessages?: string[];
    }>;
  }>;
}

function findVitestBin(testFilePath: string): string {
  let dir = dirname(testFilePath);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'node_modules', '.bin', 'vitest');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'vitest';
}

function strategyFromAncestors(ancestors: string[]): TestStrategy {
  const label = ancestors.join(' ').toLowerCase();
  if (label.includes('boundary')) return 'boundary';
  if (label.includes('happy')) return 'happy-path';
  if (label.includes('error')) return 'error-path';
  if (label.includes('behavioral') || label.includes('property') || label.includes('contract')) {
    return 'behavioral-mirror';
  }
  return 'boundary';
}

function buildRunnerFailure(message: string): FunctionReport[] {
  return [
    {
      functionName: 'testgen',
      results: [
        classifyResult({
          passed: false,
          strategy: 'error-path',
          description: 'runs generated tests',
          error: message,
        }),
      ],
    },
  ];
}

export function runVitest(testFilePath: string): Promise<FunctionReport[]> {
  return new Promise((resolve) => {
    const child = spawn(
      findVitestBin(testFilePath),
      ['run', testFilePath, '--reporter=json', '--no-coverage'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (error) => {
      resolve(buildRunnerFailure(`vitest unavailable: ${error.message}`));
    });

    child.on('close', () => {
      const jsonStart = stdout.indexOf('{');
      if (jsonStart === -1) {
        resolve(buildRunnerFailure(stderr.trim() || 'vitest did not emit JSON output'));
        return;
      }

      let parsed: VitestJsonResult;
      try {
        parsed = JSON.parse(stdout.slice(jsonStart)) as VitestJsonResult;
      } catch {
        resolve(buildRunnerFailure(`failed to parse vitest JSON output: ${stderr.trim()}`));
        return;
      }

      const reportsByFn = new Map<string, TestResult[]>();
      for (const fileResult of parsed.testResults ?? []) {
        for (const test of fileResult.testResults ?? []) {
          const ancestors = test.ancestorTitles ?? [];
          const functionName = ancestors[0] ?? 'unknown';
          const result = classifyResult({
            passed: test.status === 'passed',
            strategy: strategyFromAncestors(ancestors),
            description: test.title ?? 'unnamed test',
            error: test.failureMessages?.[0],
          });
          const results = reportsByFn.get(functionName) ?? [];
          results.push(result);
          reportsByFn.set(functionName, results);
        }
      }

      resolve(
        [...reportsByFn.entries()].map(([functionName, results]) => ({
          functionName,
          results,
        }))
      );
    });
  });
}
