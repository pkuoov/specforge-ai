#!/usr/bin/env node
import { runTestgen, formatReport } from '../dist/index.js';

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const auto = args.includes('--auto');
const silentIfTested = args.includes('--silent-if-tested');
const overwrite = args.includes('--overwrite');
const runAfterWrite = args.includes('--run');
const modeArg = args.find((a) => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'both';
const invalidArg = args.find((a) => a.startsWith('--invalid-input='));
const invalidInputStrategy = invalidArg ? invalidArg.split('=')[1] : undefined;

if (
  invalidInputStrategy &&
  !['no-throw', 'throw', 'skip'].includes(invalidInputStrategy)
) {
  console.error('testgen-ts: --invalid-input must be one of no-throw, throw, skip');
  process.exit(1);
}

if (!filePath) {
  console.error('Usage: testgen-ts <file.ts> [--mode=standard|property|both] [--dry-run] [--run] [--overwrite] [--invalid-input=no-throw|throw|skip]');
  process.exit(1);
}

const report = await runTestgen(filePath, {
  mode,
  dryRun,
  auto,
  silentIfTested,
  overwrite,
  runAfterWrite,
  ...(invalidInputStrategy ? { invalidInputStrategy } : {}),
});

console.log(formatReport(report));
if (report.totalFailed > 0) {
  process.exitCode = 1;
}
