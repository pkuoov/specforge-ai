import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { FailurePattern, FunctionReport, TestResult, TestStrategy } from '@testgen/core';

export interface VitestJsonResult {
  testResults: Array<{
    testFilePath: string;
    status: 'passed' | 'failed';
    testResults: Array<{
      ancestorTitles: string[];
      title: string;
      status: 'passed' | 'failed' | 'pending';
      failureMessages: string[];
      duration?: number;
    }>;
  }>;
  success: boolean;
}

function classifyFailure(error: string): FailurePattern {
  const msg = error.toLowerCase();
  if (msg.includes('cannot read') || (msg.includes('null') && msg.includes('undefined'))) {
    return 'null-deref';
  }
  if (msg.includes('received') && (msg.includes('expected') || msg.includes('but got'))) {
    return 'off-by-one';
  }
  if (msg.includes('promise') || msg.includes('async') || msg.includes('rejects')) {
    return 'async-error';
  }
  if (msg.includes('nan') || msg.includes('type') || msg.includes('coerce')) {
    return 'type-coerce';
  }
  return 'logic-error';
}

function classifyResult(result: Omit<TestResult, 'failurePattern'>): TestResult {
  if (result.passed || !result.error) {
    return { ...result, passed: true };
  }
  return { ...result, failurePattern: classifyFailure(result.error) };
}

function strategyFromAncestors(ancestors: string[]): TestStrategy {
  const label = (ancestors[1] ?? ancestors[0] ?? '').toLowerCase();
  if (label.includes('boundary')) return 'boundary';
  if (label.includes('happy')) return 'happy-path';
  if (label.includes('error')) return 'error-path';
  if (label.includes('behavioral') || label.includes('property') || label.includes('contract')) {
    return 'behavioral-mirror';
  }
  return 'boundary';
}

function findVitestBin(testFilePath: string): string {
  let dir = dirname(testFilePath);
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'node_modules', '.bin', 'vitest');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'vitest'; // fall back to PATH
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
    const vitestBin = findVitestBin(testFilePath);
    const child = spawn(
      vitestBin,
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

      for (const fileResult of parsed.testResults) {
        for (const test of fileResult.testResults) {
          const fnName = test.ancestorTitles[0] ?? 'unknown';
          const results = reportsByFn.get(fnName) ?? [];

          const strategy = strategyFromAncestors(test.ancestorTitles);
          const passed = test.status === 'passed';
          const error = test.failureMessages[0];

          const result: TestResult = {
            passed,
            strategy,
            description: test.title,
            ...(error && !passed
              ? { failurePattern: classifyFailure(error), error: error.split('\n')[0] }
              : {}),
          };

          results.push(result);
          reportsByFn.set(fnName, results);
        }
      }

      const reports: FunctionReport[] = [];
      for (const [functionName, results] of reportsByFn) {
        reports.push({ functionName, results });
      }
      resolve(reports);
    });
  });
}
