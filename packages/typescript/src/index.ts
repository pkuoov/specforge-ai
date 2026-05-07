import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import {
  generateTestPlan,
  renderTestFile,
  buildReport,
  formatReport,
  type FunctionSignature,
  type TestgenOptions,
  type TestgenReport,
} from '@testgen/core';
import { extractFunctionsFromAST, type ExtractOptions } from './ts-extractor.js';
import { renderPropertyTestFile } from './property-writer.js';
import { runVitest } from './runner.js';

export { extractFunctionsFromAST } from './ts-extractor.js';
export { typeToFcArbitrary, paramsToArbitraries } from './fc-mapper.js';
export { renderPropertyTestFile, renderPropertyBlock } from './property-writer.js';
export { runVitest } from './runner.js';
export type { ExtractOptions } from './ts-extractor.js';

export type TestgenMode = 'standard' | 'property' | 'both';

export interface TypeScriptTestgenOptions extends Partial<TestgenOptions> {
  mode?: TestgenMode;
  tsConfigPath?: string;
  overwrite?: boolean;
  invalidInputStrategy?: 'no-throw' | 'throw' | 'skip';
  runAfterWrite?: boolean;
}

export async function runTestgen(
  sourceFilePath: string,
  options: TypeScriptTestgenOptions = {}
): Promise<TestgenReport> {
  const {
    mode = 'both',
    tsConfigPath,
    runAfterWrite = false,
    dryRun = false,
    silentIfTested = false,
    overwrite = false,
    invalidInputStrategy = 'no-throw',
  } = options;

  const absolutePath = resolve(sourceFilePath);
  const dir = dirname(absolutePath);
  const base = basename(absolutePath, '.ts');
  const standardTestPath = join(dir, `${base}.test.ts`);
  const propertyTestPath = join(dir, `${base}.property.test.ts`);
  const importPath = `./${base}`;

  if (silentIfTested && existsSync(standardTestPath) && existsSync(propertyTestPath)) {
    return buildReport(sourceFilePath, []);
  }

  const targetPaths = [
    ...(mode === 'standard' || mode === 'both' ? [standardTestPath] : []),
    ...(mode === 'property' || mode === 'both' ? [propertyTestPath] : []),
  ];
  const existingPaths = targetPaths.filter((path) => existsSync(path));
  if (existingPaths.length > 0 && !overwrite) {
    throw new Error(
      `testgen: refusing to overwrite existing test file(s): ${existingPaths.join(', ')}. ` +
        'Pass --overwrite to replace them, or --silent-if-tested to skip when tests exist.'
    );
  }

  // Use AST extractor — accurate types from the compiler
  const extractOpts: ExtractOptions = { tsConfigPath };
  const sigs = extractFunctionsFromAST(absolutePath, extractOpts);

  if (sigs.length === 0) {
    console.warn(`testgen: no exported functions found in ${sourceFilePath}`);
    return buildReport(sourceFilePath, []);
  }

  const writtenFiles: string[] = [];

  if (mode === 'standard' || mode === 'both') {
    const plans = sigs.map((sig) =>
      (
        generateTestPlan as (
          sig: FunctionSignature,
          importPath: string,
          options?: { invalidInputStrategy?: 'no-throw' | 'throw' | 'skip' }
        ) => ReturnType<typeof generateTestPlan>
      )(sig, importPath, { invalidInputStrategy })
    );
    const testSource = renderTestFile(plans, sigs, importPath);
    if (!dryRun) {
      writeFileSync(standardTestPath, testSource, 'utf-8');
      writtenFiles.push(standardTestPath);
      console.log(`testgen: wrote ${standardTestPath}`);
    } else {
      console.log(`\n=== ${standardTestPath} (dry-run) ===\n${testSource}`);
    }
  }

  if (mode === 'property' || mode === 'both') {
    const propertySource = renderPropertyTestFile(sigs, importPath);
    if (!dryRun) {
      writeFileSync(propertyTestPath, propertySource, 'utf-8');
      writtenFiles.push(propertyTestPath);
      console.log(`testgen: wrote ${propertyTestPath}`);
    } else {
      console.log(`\n=== ${propertyTestPath} (dry-run) ===\n${propertySource}`);
    }
  }

  if (runAfterWrite && !dryRun && writtenFiles.length > 0) {
    const reports = await Promise.all(writtenFiles.map((f) => runVitest(f)));
    const merged = reports.flat();
    return buildReport(sourceFilePath, merged);
  }

  if (dryRun) {
    return buildReport(sourceFilePath, []);
  }

  // Generation-only mode intentionally reports no pass/fail results.
  const plans = sigs.map((sig) =>
    (
      generateTestPlan as (
        sig: FunctionSignature,
        importPath: string,
        options?: { invalidInputStrategy?: 'no-throw' | 'throw' | 'skip' }
      ) => ReturnType<typeof generateTestPlan>
    )(sig, importPath, { invalidInputStrategy })
  );
  const functionReports = plans.map((plan) => ({
    functionName: plan.functionName,
    results: [],
  }));

  return buildReport(sourceFilePath, functionReports);
}

export { formatReport };
