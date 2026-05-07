# testgen

> AI-aware test case generator for TypeScript/JavaScript.

Most test generators write tests *after* the code. **testgen** writes them *before* the implementation is read — specifically targeting the failure patterns that AI coding assistants produce most often.

---

## The problem

AI-generated code tends to fail at:

- **Boundary values** — null, undefined, empty string, 0, NaN, Infinity
- **Edge cases** — the example input works, but the logic breaks on anything else
- **Behavioral contracts** — the function returns *something*, but not what its name implies

Generic test coverage tools don't catch this because they measure line execution, not behavioral correctness.

---

## How it works

For every exported function, testgen generates four categories of tests:

| Strategy | What it tests | Catches |
|----------|--------------|---------|
| **Boundary probe** | null, undefined, 0, NaN, empty, MAX_SAFE_INTEGER | Missing null guards, off-by-one |
| **Happy path** | One representative valid call | Basic regressions |
| **Error path** | Inputs that should fail gracefully | Silent failures |
| **Behavioral mirror** | Contracts derived from *name + types only*, before reading the body | Logic inversions, assumption drift |

The behavioral mirror strategy is the key differentiator: it asks *"what must always be true of a function called `normalizeString(input: string): string`?"* and encodes those invariants as tests — before reading one line of implementation.

---

## Current status

testgen is currently usable as a P0 autotest assistant for exported TypeScript/JavaScript functions:

- It can generate tests for a single source file or a directory.
- It refuses to overwrite existing tests unless `--overwrite` is provided.
- It runs Vitest by default and does not report unexecuted tests as passed.
- It supports project-level JSON config via `.testgenrc`, `.testgenrc.json`, or `testgen.config.json`.
- It supports invalid-input policy selection with `no-throw`, `throw`, or `skip`.
- It prefers TypeScript AST extraction when TypeScript is available, then falls back to regex extraction.
- It can merge generated output into a protected `// <testgen:generated>` block with `--merge`.
- It supports default function exports, default class static methods, local export specifiers, cross-file named re-exports, namespace re-exports, top-level overload signatures, namespace functions, class static methods, and object-exported functions in AST mode.
- It includes behavioral contracts for predicates, validators, parse/get/date/format/create helpers, grouping helpers, uniqueness helpers, and min/max/average utilities.
- It can turn simple JSDoc examples such as `@example add(1, 2) => 3` and literal returns such as `return 42` into concrete `toEqual` happy-path tests.
- It generates simple object fixtures from inline object parameter types and common domain type names such as `User`, `Order`, `Config`, and `Date`.
- It includes Claude Code and Codex skill definitions.
- It includes CI checks for typecheck, tests, build, dogfood generation, public audit, and package pack checks.

Known limits:

- React components, API routes, class/interface overload forms, and complex module shapes need P1/P2 work.
- `testgen.config.ts` is not supported yet; config is JSON-only to avoid runtime loader dependencies.

---

## Quick start

```bash
# Install
pnpm add -D @testgen/core vitest @fast-check/vitest

# Generate tests for a file
npx testgen src/utils/math.ts

# Generate tests for every matching source file in a directory
npx testgen src/utils/

# Dry run — print without writing
npx testgen src/utils/math.ts --dry-run

# Write tests but skip validation
npx testgen src/utils/math.ts --no-run

# Replace an existing generated test file
npx testgen src/utils/math.ts --overwrite

# Merge into an existing test file without deleting manual tests
npx testgen src/utils/math.ts --merge

# Treat invalid inputs as expected throws instead of no-throw probes
npx testgen src/utils/math.ts --invalid-input=throw
```

### Example

**Input: `src/utils/clamp.ts`**
```typescript
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
```

**Output: `src/utils/clamp.test.ts`** (generated)
```typescript
import { describe, it, expect } from 'vitest';
import { clamp } from './clamp';

describe('clamp', () => {
  describe('boundary cases', () => {
    it('handles value=NaN', () => { /* ... */ });
    it('handles value=Infinity', () => { /* ... */ });
    it('handles value=null', () => { /* ... */ });
    // ... 8 more boundary cases
  });

  describe('behavioral contracts', () => {
    it('returns a value within [min, max] when min <= max', () => {
      const result = clamp(42, 0, 100);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });
  });
});
```

---

## Usage with AI coding tools

### Claude Code skill

Copy the Claude skill into your Claude Code agents directory:

```bash
mkdir -p ~/.claude/agents
cp skill/testgen.md ~/.claude/agents/testgen.md
```

Then use `/testgen src/utils/math.ts` in a Claude Code session.

### Codex skill

Copy the Codex skill folder into your Codex skills directory:

```bash
mkdir -p ~/.codex/skills
cp -R skill/codex/testgen ~/.codex/skills/testgen
```

Codex will auto-discover `~/.codex/skills/testgen/SKILL.md`.

### Claude Code PostToolUse hook

Run automatically after every AI code edit:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "npx testgen \"$FILE_PATH\" --auto --silent-if-tested",
        "description": "Generate tests for new/modified source files"
      }
    ]
  }
}
```

Add this to `.claude/settings.json` in your project. testgen will skip files that already have a `.test.ts`.

## CLI options

```
npx testgen <file-or-dir> [options]

Options:
  --auto              Non-interactive mode (skip all prompts)
  --silent-if-tested  Do nothing if a .test.ts already exists
  --dry-run           Print generated test file without writing it
  --overwrite         Replace an existing .test.ts
  --merge             Update or append a protected generated block
  --no-run            Write tests without running Vitest
  --invalid-input     Invalid input strategy: no-throw, throw, or skip
  --extractor         Extraction mode: auto, regex, or typescript
```

By default, `testgen` refuses to overwrite existing tests and runs Vitest after writing. Dry runs and `--no-run` never report generated tests as passed.

### Configuration

Add `.testgenrc`, `.testgenrc.json`, or `testgen.config.json` to a project root:

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

Config fields:

- `runner`: currently `vitest`; `jest` is reserved for future support.
- `testDir`: optional output directory. When omitted, tests are written beside the source file.
- `include` / `exclude`: glob-like filters used when the CLI target is a directory.
- `invalidInputStrategy`: `no-throw` generates crash-detection probes, `throw` expects invalid inputs to throw, and `skip` omits generated invalid-input error-path tests.
- `merge`: when `true`, existing tests are preserved and generated content is updated inside `// <testgen:generated>` markers.
- `extractor`: `auto` prefers TypeScript AST extraction when available, `regex` forces the lightweight extractor, and `typescript` fails if AST extraction cannot run.

---

## Two packages, two levels of depth

### `@testgen/core` — fast, AST-first when available

Prefers TypeScript AST extraction when `typescript` is available and falls back to regex extraction. Good for CI hooks where speed matters but exported function shapes may be slightly richer than simple declarations.

```bash
npx testgen src/utils/math.ts
# writes: math.test.ts  (boundary + happy-path + error-path + behavioral-mirror)
```

### `@testgen/typescript` — AST-accurate + property-based

Uses the TypeScript Compiler API for exact types, then maps them to `fast-check` arbitraries.

```bash
npx testgen-ts src/utils/math.ts --mode=both
# writes: math.test.ts           (standard test suite)
#         math.property.test.ts  (fast-check property tests)
```

The type mapper handles: `string`, `number`, `boolean`, `T[]`, `[A, B]`, `A | B`, `A | null`, `Record<K,V>`, `{ field: T }`, `Map<K,V>`, `Set<T>`, `Promise<T>` — and generates the correct `fc.*` arbitrary for each.

Behavioral contracts auto-detected from function names:

| Pattern | Contract generated |
|---------|-------------------|
| `clamp(v, min, max)` | `result >= min && result <= max` (property-tested over random inputs) |
| `normalize*`, `sanitize*` | Idempotency: `f(f(x)) === f(x)` |
| `add*`, `sum*` with same-type params | Commutativity: `f(a,b) === f(b,a)` |
| `count*`, `length*`, `total*` | Returns `>= 0` |
| `sort*`, `map*`, `reverse*` on arrays | Output length equals input length |
| `filter*` | Output length `<=` input length |
| `is*`, `has*`, `validate*` | Returns a boolean |
| `unique*` | Output array contains unique values |
| `min*`, `max*`, `average*` | Numeric result respects input bounds |
| `group*` / `groupBy*` | Returns an object grouping result |

## Repo structure

```
testgen/
├── skill/
│   ├── testgen.md            Claude Code skill
│   └── codex/testgen/        Codex skill folder
├── packages/
│   ├── core/                 AST-first extraction with regex fallback, 4-strategy generator
│   └── typescript/           AST extractor (TS compiler API) + fast-check mapper
└── examples/
    └── basic-function/       clamp, sum, normalizeString, first — 4 functions
```

---

## Roadmap

### P0 — Minimum trustworthy autotest signal

Status: complete.

- [x] Prevent unexecuted tests from being reported as passed
- [x] Refuse to overwrite existing tests by default
- [x] Make boundary/error-path failures visible instead of swallowing exceptions
- [x] Add directory input support with include/exclude filtering
- [x] Add JSON config files: `.testgenrc`, `.testgenrc.json`, `testgen.config.json`
- [x] Add invalid input policies: `no-throw`, `throw`, `skip`
- [x] Add real contract assertions for common name patterns
- [x] Add runner failure reporting when Vitest is missing or JSON output cannot be parsed
- [x] Add Claude Code and Codex skills

### P1 — Production-grade generated tests

Status: in progress.

- [x] Make the TypeScript AST extractor the default when TypeScript is available
- [x] Add safe merge mode for existing tests instead of only skip/overwrite
- [x] Add deterministic output formatting and remove generated-name randomness
- [x] Expand behavioral contracts for predicate, validate, groupBy, unique, min/max, and average utilities
- [x] Support default function exports, default class static methods, local export specifiers, namespace functions, class static methods, and object-exported functions
- [x] Use simple JSDoc examples as concrete expected values
- [x] Improve expected values using simple literal return cues
- [x] Expand behavioral contracts for parse, get*, and date utilities
- [x] Support cross-file named re-exports
- [x] Add fixture generation for inline object parameters and common domain-shaped values
- [x] Add generated-region update workflow through `--merge` markers
- [x] Support top-level overload-specific cases and namespace re-export forms
- [ ] Refine domain-shaped fixtures with project-local type/interface field extraction
- [ ] Support class/interface overload forms

### P2 — Broader framework and CI integration

Status: planned.

- [ ] React component tests with Testing Library
- [ ] API route/request-response contract tests
- [ ] Jest, Bun test, and Node test runner support
- [x] GitHub Action for typecheck, tests, build, dogfood generation, public audit, and package pack checks
- [x] Public repository audit script for sensitive content, local paths, and forbidden env/key files
- [ ] Mutation testing integration with Stryker
- [ ] Coverage delta reporting
- [ ] `testgen.config.ts` support with a deliberate loader strategy
- [ ] Python adapter using Hypothesis
- [ ] VS Code extension

---

## Contributing

PRs welcome. Please open an issue first for anything beyond bug fixes.

Before publishing or pushing a public mirror, run:

```bash
pnpm public-audit
pnpm typecheck
pnpm test
pnpm build
mkdir -p /tmp/testgen-packcheck
pnpm -r packcheck
```

---

## License

MIT
