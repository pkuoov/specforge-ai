# testgen

AI-aware test case generator for TypeScript/JavaScript. Generates boundary, happy-path, error-path, and behavioral-mirror tests specifically targeting failure patterns common in AI-generated code.

## Architecture

```
packages/core/        — Orchestration: extractor → generator → writer → reporter
packages/typescript/  — Vitest + fast-check adapter
skill/testgen.md      — Claude Code skill
skill/codex/testgen/  — Codex skill
examples/             — Runnable demos
```

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (dogfooded — testgen tests itself)
pnpm test

# Generate tests for an example file
node packages/core/bin/testgen.js examples/basic-function/clamp.ts

# Dry run (print without writing)
node packages/core/bin/testgen.js examples/basic-function/clamp.ts --dry-run

# Write without validating
node packages/core/bin/testgen.js examples/basic-function/clamp.ts --no-run

# Explicitly replace an existing test file
node packages/core/bin/testgen.js examples/basic-function/clamp.ts --overwrite

# Preserve manual tests and update/append the generated block
node packages/core/bin/testgen.js examples/basic-function/clamp.ts --merge
```

## Development workflow

1. Edit source in `packages/core/src/`
2. `pnpm build` to compile
3. `pnpm test` to run tests
4. Test against examples: `node packages/core/bin/testgen.js examples/basic-function/clamp.ts`

## Current phase

P0 is complete. P1 is mostly complete. Core and TypeScript packages are available. The core CLI writes standard Vitest tests, supports directory targets, respects JSON config, refuses overwrites by default, supports safe merge blocks, prefers TypeScript AST extraction when available, supports default function exports/default class static methods/cross-file named and namespace re-exports/top-level overload signatures/namespace functions/object-exported functions, uses simple JSDoc examples and literal returns as concrete expected values, generates inline object and common domain-shaped fixtures, and runs Vitest by default. The TypeScript package adds deeper AST extraction and fast-check property test generation.

## P1/P2 implementation queue

P1 should finish the remaining production-grade generated-test refinements:

1. Refine domain-shaped fixtures with project-local type/interface field extraction.
2. Support class/interface overload forms.
3. Expand behavioral contract patterns for additional domain utilities.
4. Refine generated-region update UX beyond the current `--merge` marker workflow.

P2 should broaden integrations:

1. React component tests with Testing Library.
2. API route/request-response contract tests.
3. Jest, Bun test, and Node test runner support.
4. Mutation testing integration.
5. Coverage delta reporting and `testgen.config.ts` support.

Already implemented P2 infrastructure: GitHub Actions CI, dogfood generation, public repository audit, and package pack checks.

## Test runner requirement

Examples use Vitest. Install in the example directory before running generated tests:
```bash
cd examples/basic-function && pnpm add -D vitest @fast-check/vitest
```
