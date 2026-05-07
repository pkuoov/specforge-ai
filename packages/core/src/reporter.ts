import type { FailurePattern, FunctionReport, TestResult, TestgenReport } from './types.js';

function classifyFailure(error: string): FailurePattern {
  const msg = error.toLowerCase();
  if (msg.includes('cannot read') || msg.includes('null') || msg.includes('undefined')) {
    return 'null-deref';
  }
  if (msg.includes('off by one') || msg.includes('expected') && msg.includes('received')) {
    return 'off-by-one';
  }
  if (msg.includes('async') || msg.includes('promise') || msg.includes('await')) {
    return 'async-error';
  }
  if (msg.includes('type') || msg.includes('nan') || msg.includes('coerce')) {
    return 'type-coerce';
  }
  return 'logic-error';
}

const STRATEGY_LABELS: Record<string, string> = {
  'boundary': 'boundary       ',
  'happy-path': 'happy-path     ',
  'error-path': 'error-path     ',
  'behavioral-mirror': 'behavioral-mirror',
};

export function buildReport(
  sourceFile: string,
  functionReports: FunctionReport[]
): TestgenReport {
  const totalPassed = functionReports.reduce(
    (sum, r) => sum + r.results.filter((t) => t.passed).length,
    0
  );
  const totalFailed = functionReports.reduce(
    (sum, r) => sum + r.results.filter((t) => !t.passed).length,
    0
  );
  return { sourceFile, functions: functionReports, totalPassed, totalFailed };
}

export function classifyResult(result: Omit<TestResult, 'failurePattern'>): TestResult {
  if (result.passed || !result.error) {
    return { ...result, passed: true };
  }
  return { ...result, failurePattern: classifyFailure(result.error) };
}

export function formatReport(report: TestgenReport): string {
  const lines: string[] = [
    ``,
    `testgen report — ${report.sourceFile}`,
    `${'─'.repeat(50)}`,
  ];

  for (const fn of report.functions) {
    lines.push(`\nFunction: ${fn.functionName}`);
    const byStrategy = new Map<string, { passed: number; total: number }>();

    for (const r of fn.results) {
      const bucket = byStrategy.get(r.strategy) ?? { passed: 0, total: 0 };
      bucket.total++;
      if (r.passed) bucket.passed++;
      byStrategy.set(r.strategy, bucket);
    }

    for (const [strategy, counts] of byStrategy) {
      const icon = counts.passed === counts.total ? '✓' : '✗';
      const label = STRATEGY_LABELS[strategy] ?? strategy.padEnd(17);
      const failed = counts.total - counts.passed;
      const note = failed > 0 ? `  (${failed} failed)` : '';
      lines.push(`  ${icon} ${label}: ${counts.passed}/${counts.total} passed${note}`);
    }

    const failures = fn.results.filter((r) => !r.passed);
    if (failures.length > 0) {
      lines.push(`\n  Failures:`);
      for (const f of failures) {
        const tag = f.failurePattern ? `[${f.failurePattern}]` : '[unknown]';
        lines.push(`    ${tag.padEnd(16)} ${f.description}`);
        if (f.error) lines.push(`    ${''.padEnd(16)} → ${f.error.split('\n')[0]}`);
      }
    }
  }

  lines.push('');
  lines.push(`${'─'.repeat(50)}`);
  lines.push(`Total: ${report.totalPassed} passed, ${report.totalFailed} failed`);
  lines.push('');

  return lines.join('\n');
}
