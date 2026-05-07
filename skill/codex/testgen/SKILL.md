---
name: testgen
description: Generate and validate TypeScript/JavaScript test cases with the testgen CLI. Use when Codex is asked to create tests, generate test cases, add autotest coverage, test a function or file, dogfood testgen, or run AI-aware boundary, happy-path, error-path, and behavioral-mirror tests for exported functions.
---

# testgen

Use this skill to generate AI-aware tests for TypeScript/JavaScript source files with `testgen`.

## Workflow

1. Identify the target file or small directory from the user request.
2. For a directory, expand source files with `.ts`, `.tsx`, `.js`, or `.jsx`, and skip `*.test.*`, `*.spec.*`, declaration files, `node_modules`, and build output.
3. Check whether a sibling `.test.ts` already exists.
4. Run `npx testgen <file>` for each target file.
5. Report the generated files and the real Vitest result.

Do not report generated tests as passed unless the test runner actually executed them.

## CLI Commands

```bash
npx testgen src/utils/math.ts
npx testgen src/utils/
npx testgen src/utils/math.ts --dry-run
npx testgen src/utils/math.ts --no-run
npx testgen src/utils/math.ts --overwrite
npx testgen src/utils/math.ts --merge
npx testgen src/utils/math.ts --invalid-input=throw
npx testgen src/utils/math.ts --extractor=typescript
```

Use `--dry-run` to preview without writing. Use `--no-run` only when the user explicitly wants generation without validation. Use `--overwrite` only after the user explicitly approves replacing an existing test file. Prefer `--merge` when a test file already contains manual tests that should be preserved. Use `--invalid-input=no-throw|throw|skip` to match the target project's invalid input contract. Use `--extractor=regex` only when TypeScript AST extraction is too slow or unavailable.

## Configuration

Respect `.testgenrc`, `.testgenrc.json`, or `testgen.config.json` when present:

```json
{
  "runner": "vitest",
  "testDir": "__generated_tests__",
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/*.test.*", "**/*.spec.*", "**/*.d.ts", "**/dist/**"],
  "invalidInputStrategy": "no-throw",
  "merge": false,
  "extractor": "auto"
}
```

## Test Strategy

Generate four categories per exported function:

- `boundary`: null, undefined, empty, zero, NaN, Infinity, safe integer limits, and collection edge cases.
- `happy-path`: one realistic valid call inferred from names and types.
- `error-path`: invalid or invariant-breaking inputs that should fail loudly or gracefully.
- `behavioral-mirror`: contracts inferred from function name and type signature before relying on implementation details.

Behavioral mirror examples:

- `sort(items)` preserves output length.
- `filter(items)` returns length less than or equal to input length.
- `normalizeText(text)` is idempotent.
- `countItems(...)` returns a non-negative number for valid inputs.
- `isValid(...)`, `hasAccess(...)`, or `validateUser(...)` returns a boolean.
- `uniqueValues(items)` returns an array with no duplicates.
- `minValue(values)`, `maxValue(values)`, and `average(values)` respect numeric input bounds.
- `groupByCategory(items)` returns an object grouping result.

## Guardrails

- Never modify the source file when generating tests.
- Never overwrite an existing test file unless the user explicitly asks for overwrite.
- Prefer `--merge` over `--overwrite` when preserving manual tests matters.
- Never swallow boundary or error-path failures just to keep generated tests green.
- Prefer observable behavior over implementation details.
- If Vitest is missing, surface the install command and clearly state that validation did not run.
- Treat React components, API routes, Jest/Bun/Node runner support, mutation testing, coverage delta, and `testgen.config.ts` as future P2 work unless the repo has implemented them.

## Current Phase

P0 and P1 are complete: single-file and directory generation, JSON config, overwrite protection, safe merge blocks with create/update/overwrite status messages, AST-first extraction with regex fallback, default function exports, default class static methods, cross-file named and namespace re-exports, top-level and class static overload signatures, namespace functions, object-exported functions, simple JSDoc/literal expected values, inline object/project-local type/interface/common domain-shaped fixtures, real runner results, invalid-input policies, and expanded behavioral contracts are implemented.

Next planned work:

- P2 remaining: React/API route generation, instance method generation, Jest/Bun/Node runner support, mutation testing, coverage delta, and `testgen.config.ts`. CI, public audit, dogfood generation, and package pack checks are implemented.

## Dependency Hint

If the target project does not have a runner, suggest:

```bash
pnpm add -D vitest @fast-check/vitest
```

Use the package manager already used by the target repo when it is clear.
