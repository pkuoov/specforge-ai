import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, join, relative, extname } from 'node:path';
import { extractFunctions } from './extractor.js';
import { extractFunctionsFromTypeScript } from './ts-extractor.js';
import { generateTestPlan } from './generator.js';
import { renderTestFile } from './writer.js';
import { mergeGeneratedTestSource, wrapGeneratedTestSource } from './merge.js';
import { formatReport, buildReport } from './reporter.js';
import { runVitest } from './runner.js';
import { loadConfig, mergeOptions } from './config.js';
import { expandTargets } from './files.js';
import type { FunctionReport, TestgenOptions, TestgenReport } from './types.js';

export { extractFunctions } from './extractor.js';
export { extractFunctionsFromTypeScript } from './ts-extractor.js';
export { generateTestPlan } from './generator.js';
export { renderTestFile } from './writer.js';
export { mergeGeneratedTestSource, wrapGeneratedTestSource } from './merge.js';
export { buildReport, classifyResult, formatReport } from './reporter.js';
export { runVitest } from './runner.js';
export { loadConfig, mergeOptions } from './config.js';
export { expandTargets } from './files.js';
export type * from './types.js';

function stripExtension(path: string): string {
  return path.slice(0, -extname(path).length);
}

function toImportPath(fromDir: string, sourceFilePath: string): string {
  const relativePath = stripExtension(relative(fromDir, sourceFilePath)).split('\\').join('/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function getTestFilePath(sourceFilePath: string, opts: TestgenOptions): string {
  const dir = dirname(sourceFilePath);
  const base = basename(sourceFilePath, extname(sourceFilePath));
  if (!opts.testDir) return join(dir, `${base}.test.ts`);

  const rootDir = resolve(opts.configDir ?? process.cwd());
  const outputDir = join(resolve(rootDir, opts.testDir), dirname(relative(rootDir, sourceFilePath)));
  return join(outputDir, `${base}.test.ts`);
}

async function extractSignatures(sourceFilePath: string, source: string, opts: TestgenOptions) {
  const ext = extname(sourceFilePath);
  const shouldUseTypeScript =
    opts.extractor === 'typescript' ||
    (opts.extractor === 'auto' && ['.ts', '.tsx', '.js', '.jsx'].includes(ext));

  if (!shouldUseTypeScript) return extractFunctions(source);

  try {
    const sigs = await extractFunctionsFromTypeScript(sourceFilePath);
    return sigs.length > 0 ? sigs : extractFunctions(source);
  } catch (err) {
    if (opts.extractor === 'typescript') throw err;
    return extractFunctions(source);
  }
}

export async function runTestgen(
  sourceFilePath: string,
  options: Partial<TestgenOptions> = {}
): Promise<TestgenReport> {
  const loaded = loadConfig(process.cwd());
  const opts = mergeOptions(loaded.config, options, options.configDir ?? loaded.configDir);

  const absolutePath = resolve(sourceFilePath);
  const testFilePath = getTestFilePath(absolutePath, opts);
  const testDir = dirname(testFilePath);

  if (opts.silentIfTested && existsSync(testFilePath)) {
    return buildReport(sourceFilePath, []);
  }

  if (existsSync(testFilePath) && !opts.overwrite && !opts.merge && !opts.dryRun) {
    throw new Error(
      `testgen: refusing to overwrite existing test file ${testFilePath}. ` +
        'Pass --overwrite to replace it, --merge to update a generated block, or --silent-if-tested to skip it.'
    );
  }

  const source = readFileSync(absolutePath, 'utf-8');
  const sigs = await extractSignatures(absolutePath, source, opts);

  if (sigs.length === 0) {
    console.warn(`testgen: no exported functions found in ${sourceFilePath}`);
    return buildReport(sourceFilePath, []);
  }

  const importPath = toImportPath(testDir, absolutePath);
  const testFileExists = existsSync(testFilePath);
  const plans = sigs.map((sig) =>
    generateTestPlan(sig, importPath, {
      invalidInputStrategy: opts.invalidInputStrategy,
    })
  );
  const testSource = renderTestFile(plans, sigs, importPath);
  const outputSource = opts.merge
    ? testFileExists
      ? mergeGeneratedTestSource(readFileSync(testFilePath, 'utf-8'), testSource)
      : wrapGeneratedTestSource(testSource)
    : testSource;
  const writeAction = opts.merge
    ? testFileExists
      ? 'updated generated block in'
      : 'created generated block in'
    : testFileExists && opts.overwrite
      ? 'overwrote'
      : 'wrote';
  const dryRunAction = opts.merge
    ? testFileExists
      ? 'update generated block in'
      : 'create generated block in'
    : testFileExists && opts.overwrite
      ? 'overwrite'
      : 'write';

  if (!opts.dryRun) {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testFilePath, outputSource, 'utf-8');
    console.log(`testgen: ${writeAction} ${testFilePath}`);
  } else {
    console.log(`testgen (dry-run): would ${dryRunAction} ${testFilePath}`);
    console.log(outputSource);
    return buildReport(sourceFilePath, []);
  }

  if (opts.runAfterWrite) {
    const functionReports = await runVitest(testFilePath);
    return buildReport(sourceFilePath, functionReports);
  }

  // Generation-only mode intentionally reports no pass/fail results.
  const functionReports: FunctionReport[] = plans.map((plan) => ({
    functionName: plan.functionName,
    results: [],
  }));

  return buildReport(sourceFilePath, functionReports);
}
