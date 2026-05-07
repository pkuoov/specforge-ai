#!/usr/bin/env node
import { runTestgen, formatReport } from '../dist/index.js';

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const auto = args.includes('--auto');
const silentIfTested = args.includes('--silent-if-tested');
const runAfterWrite = args.includes('--run');
const modeArg = args.find((a) => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'both';

if (!filePath) {
  console.error('Usage: testgen-ts <file.ts> [--mode=standard|property|both] [--dry-run] [--run]');
  process.exit(1);
}

const report = await runTestgen(filePath, {
  mode,
  dryRun,
  auto,
  silentIfTested,
  runAfterWrite,
});

console.log(formatReport(report));
