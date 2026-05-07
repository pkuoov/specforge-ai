# testgen

AI-aware test case generator for TypeScript/JavaScript. Generates boundary, happy-path, error-path, and behavioral-mirror tests specifically targeting failure patterns common in AI-generated code.

## Architecture

```
packages/core/        — Orchestration: extractor → generator → writer → reporter
packages/typescript/  — Vitest + fast-check adapter (Phase 3)
skill/testgen.md      — Claude Code skill
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
```

## Development workflow

1. Edit source in `packages/core/src/`
2. `pnpm build` to compile
3. `pnpm test` to run tests
4. Test against examples: `node packages/core/bin/testgen.js examples/basic-function/clamp.ts`

## Current phase

Phase 2 — core package complete. Phase 3 (TypeScript adapter with fast-check integration) is next.

## Test runner requirement

Examples use Vitest. Install in the example directory before running generated tests:
```bash
cd examples/basic-function && pnpm add -D vitest @fast-check/vitest
```
