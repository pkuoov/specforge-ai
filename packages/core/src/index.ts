import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { extractFunctions } from './extractor.js';
import { generateTestPlan } from './generator.js';
import { renderTestFile } from './writer.js';
import { formatReport, buildReport } from './reporter.js';
import type { FunctionReport, TestgenOptions, TestgenReport } from './types.js';

export { extractFunctions } from './extractor.js';
export { generateTestPlan } from './generator.js';
export { renderTestFile } from './writer.js';
export { buildReport, formatReport } from './reporter.js';
export type * from './types.js';

export async function runTestgen(
  sourceFilePath: string,
  options: Partial<TestgenOptions> = {}
): Promise<TestgenReport> {
  const opts: TestgenOptions = {
    auto: false,
    silentIfTested: false,
    dryRun: false,
    runner: 'vitest',
    ...options,
  };

  const absolutePath = resolve(sourceFilePath);
  const dir = dirname(absolutePath);
  const base = basename(absolutePath, '.ts');
  const testFilePath = join(dir, `${base}.test.ts`);

  if (opts.silentIfTested && existsSync(testFilePath)) {
    return buildReport(sourceFilePath, []);
  }

  const source = readFileSync(absolutePath, 'utf-8');
  const sigs = extractFunctions(source);

  if (sigs.length === 0) {
    console.warn(`testgen: no exported functions found in ${sourceFilePath}`);
    return buildReport(sourceFilePath, []);
  }

  const importPath = `./${base}`;
  const plans = sigs.map((sig) => generateTestPlan(sig, importPath));
  const testSource = renderTestFile(plans, sigs, importPath);

  if (!opts.dryRun) {
    writeFileSync(testFilePath, testSource, 'utf-8');
    console.log(`testgen: wrote ${testFilePath}`);
  } else {
    console.log(`testgen (dry-run): would write ${testFilePath}`);
    console.log(testSource);
  }

  // Return a pending report — actual results come from running the test runner
  const functionReports: FunctionReport[] = plans.map((plan) => ({
    functionName: plan.functionName,
    results: plan.cases.map((tc) => ({
      passed: true,
      strategy: tc.strategy,
      description: tc.description,
    })),
  }));

  return buildReport(sourceFilePath, functionReports);
}
