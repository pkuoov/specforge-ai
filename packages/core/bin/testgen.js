#!/usr/bin/env node
// @ts-check
import {
  runTestgen,
  formatReport,
  buildReport,
  expandTargets,
  loadConfig,
  mergeOptions,
} from '../dist/index.js';

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const auto = args.includes('--auto');
const silentIfTested = args.includes('--silent-if-tested');
const dryRun = args.includes('--dry-run');
const overwrite = args.includes('--overwrite');
const merge = args.includes('--merge');
const runAfterWrite = !args.includes('--no-run');
const invalidArg = args.find((a) => a.startsWith('--invalid-input='));
const invalidInputStrategy = invalidArg ? invalidArg.split('=')[1] : undefined;
const extractorArg = args.find((a) => a.startsWith('--extractor='));
const extractor = extractorArg ? extractorArg.split('=')[1] : undefined;
if (
  invalidInputStrategy &&
  !['no-throw', 'throw', 'skip'].includes(invalidInputStrategy)
) {
  console.error('testgen: --invalid-input must be one of no-throw, throw, skip');
  process.exit(1);
}
if (extractor && !['auto', 'regex', 'typescript'].includes(extractor)) {
  console.error('testgen: --extractor must be one of auto, regex, typescript');
  process.exit(1);
}

if (!filePath) {
  console.error('Usage: testgen <file-or-dir> [--auto] [--silent-if-tested] [--dry-run] [--overwrite] [--merge] [--no-run] [--invalid-input=no-throw|throw|skip] [--extractor=auto|regex|typescript]');
  process.exit(1);
}

const loaded = loadConfig(process.cwd());
const options = mergeOptions(loaded.config, {
  auto,
  silentIfTested,
  dryRun,
  overwrite,
  runAfterWrite,
  ...(merge ? { merge } : {}),
  ...(invalidInputStrategy ? { invalidInputStrategy } : {}),
  ...(extractor ? { extractor } : {}),
}, loaded.configDir);

const targets = expandTargets(filePath, {
  include: options.include,
  exclude: options.exclude,
  rootDir: options.configDir,
});

if (targets.length === 0) {
  console.error(`testgen: no source files matched ${filePath}`);
  process.exit(1);
}

const reports = [];
for (const target of targets) {
  reports.push(await runTestgen(target, options));
}

const report = buildReport(
  filePath,
  reports.flatMap((r) => r.functions)
);
console.log(formatReport(report));
if (report.totalFailed > 0) {
  process.exitCode = 1;
}
