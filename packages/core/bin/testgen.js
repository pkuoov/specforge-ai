#!/usr/bin/env node
// @ts-check
import { runTestgen, formatReport } from '../dist/index.js';

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const auto = args.includes('--auto');
const silentIfTested = args.includes('--silent-if-tested');
const dryRun = args.includes('--dry-run');

if (!filePath) {
  console.error('Usage: testgen <file.ts> [--auto] [--silent-if-tested] [--dry-run]');
  process.exit(1);
}

const report = await runTestgen(filePath, { auto, silentIfTested, dryRun });
console.log(formatReport(report));
