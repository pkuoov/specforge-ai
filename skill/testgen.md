# testgen — Claude Code AI-Aware Test Case Generator

Generate comprehensive test suites for TypeScript/JavaScript functions, specifically targeting the failure patterns common in AI-generated code.

## Trigger

Invoke when the user runs `/testgen` or asks Claude Code to generate tests for a TypeScript/JavaScript file, function, or small directory.

## What this skill does

1. Reads the target source file(s)
2. Extracts every exported function's signature, parameter types, return type, and name semantics
3. Generates four test categories per function (see strategies below)
4. Writes a `.test.ts` file alongside the source
5. Runs the tests and classifies failures by pattern type
6. Reports a pass/fail verdict with actionable output

## Input

The user provides one of:
- A file path: `/testgen src/utils/calculate.ts`
- A directory: `/testgen src/utils/`
- No argument only when Claude Code has a current file path in context; otherwise ask for the target path.

For directory input, expand to source files (`.ts`, `.tsx`, `.js`, `.jsx`) and skip existing test files (`*.test.*`, `*.spec.*`) before invoking the CLI per file.

## Four Test Strategies

### 1. Boundary Probe
Test inputs at the edges of every parameter's type domain. These catch the most common AI mistakes.

For each parameter, generate cases:
- `null`, `undefined`
- Empty: `""`, `[]`, `{}`
- Zero: `0`, `-0`, `NaN`, `Infinity`, `-Infinity`
- Integer limits: `Number.MAX_SAFE_INTEGER`, `Number.MIN_SAFE_INTEGER`
- Boolean both values when type is ambiguous
- Single-element arrays/objects when collection expected

### 2. Happy Path
One representative valid call per function using realistic, domain-appropriate values inferred from the function name and parameter names.

### 3. Error Path
Inputs designed to trigger error states — wrong types (if untyped), values that violate documented invariants, or combinations that should throw.

### 4. Behavioral Mirror (most important)
Generate tests from the function **name and type signature only**, before reading the implementation body. Ask: "What should a function called `X` that takes `(a: T) => U` always be true of?" These tests encode behavioral contracts that survive refactoring.

Examples:
- A `sort` function's output should have the same length as its input
- A `calculateTotal` should return a number >= 0 for positive inputs
- A `parseDate` should return null/throw for non-date strings, not silently return a wrong date
- An `add(a, b)` result should equal `add(b, a)` (commutativity)

## Implementation Steps

### Step 1 — Read the source file

Read the target file completely. Extract:
```
For each exported function:
  - name
  - parameters: [{name, type, optional, defaultValue}]
  - returnType
  - isAsync
  - JSDoc description (if any)
  - function body (for implementation-aware tests only — NOT for behavioral mirror)
```

### Step 2 — Generate test cases

For each function, produce a structured test plan:

```typescript
interface TestPlan {
  functionName: string;
  importPath: string;
  cases: TestCase[];
}

interface TestCase {
  strategy: 'boundary' | 'happy-path' | 'error-path' | 'behavioral-mirror';
  description: string;
  inputs: unknown[];
  expectation: {
    type: 'return' | 'throw' | 'property';
    value?: unknown;         // exact value (happy path, boundaries)
    pattern?: string;        // property assertion (mirror tests)
    errorType?: string;      // for throw assertions
  };
}
```

### Step 3 — Write the test file

Place the test file at the same path as the source with `.test.ts` suffix.

Use Vitest syntax (compatible with Jest):

```typescript
import { describe, it, expect } from 'vitest';
import { fc } from '@fast-check/vitest'; // property-based cases
import { functionName } from './source';

describe('functionName', () => {
  describe('boundary cases', () => {
    it('handles null input', () => {
      expect(() => functionName(null as any)).not.toThrow();
      // OR: adjust assertion based on function contract
    });
    // ... more boundary cases
  });

  describe('happy path', () => {
    it('returns expected value for valid input', () => {
      expect(functionName(validInput)).toEqual(expectedOutput);
    });
  });

  describe('error path', () => {
    it('throws for invalid input', () => {
      expect(() => functionName(invalidInput)).toThrow();
    });
  });

  describe('behavioral contracts (mirror)', () => {
    it('contract: describe the invariant', () => {
      // property assertion that holds regardless of implementation
      expect(result).toSatisfy((r) => /* invariant */);
    });

    // Use fast-check for property-based contracts
    it.prop([fc.string()])('handles any string input safely', (s) => {
      const result = functionName(s);
      expect(result).toBeDefined(); // adjust to actual contract
    });
  });
});
```

### Step 4 — Run and classify failures

Run generated tests through the CLI, which invokes Vitest by default:

```bash
npx testgen <source-file>
npx testgen <source-directory>
```

Use `--no-run` only when the user explicitly wants generation without validation.
Use `--merge` when an existing test file contains manual tests that should be preserved.
Use `--invalid-input=throw` when the target project treats invalid runtime input as expected exceptions.
Use `--invalid-input=skip` when generated invalid-input probes would be too noisy.
Use `--extractor=regex` only when TypeScript AST extraction is too slow or unavailable.

The AST extractor supports named functions, default function exports, local `export { fn }` specifiers, static class methods, and object-exported functions.

Parse the output and classify each failure:

| Pattern | Classification | Common cause |
|---------|---------------|--------------|
| Threw on null/undefined | `null-deref` | Missing guard |
| Wrong value on boundary | `off-by-one` | Fence-post error |
| Behavioral contract broken | `logic-error` | Incorrect implementation |
| Async not awaited | `async-error` | Missing await |
| Type coercion wrong | `type-coerce` | Implicit JS coercion |

### Step 5 — Report

Output a summary:

```
testgen report — src/utils/calculate.ts
─────────────────────────────────────────
✓ boundary:        8/10 passed  (2 failed)
✓ happy-path:      3/3  passed
✗ error-path:      1/2  passed  (1 failed)
✓ behavioral-mirror: 4/4 passed

Failures:
  [null-deref]   calculate(null) → threw TypeError (expected: handled gracefully)
  [off-by-one]   calculate(0) → returned -1 (expected: 0)
  [logic-error]  error-path: divide(1, 0) did not throw

Coverage delta: +23% (34% → 57%)

Run `npx vitest run` to see full output.
```

## Constraints and guardrails

- **Never modify the source file** — only write test files
- **Never assert internal implementation details** — test observable behavior only
- **Behavioral mirror tests must be written before reading the function body** — generate them from name + types only, then read body to fill in happy-path values
- **If a function has no exports**, note it and skip
- **If Vitest is not installed**, detect and suggest: `pnpm add -D vitest @fast-check/vitest`
- **If the file is already tested** (`.test.ts` exists), do not overwrite by default; prefer `--merge` to preserve manual tests, or ask whether to skip or rerun with `--overwrite`

## Dependency check

Before writing tests, verify:
```bash
# Check for test runner
grep -E '"vitest"|"jest"' package.json

# Check for fast-check
grep '"@fast-check' package.json
```

If missing, output install commands. The generator can still write tests, but the report must clearly say validation did not run; never report unexecuted tests as passed.

## File naming conventions

| Source | Test file |
|--------|-----------|
| `src/utils/math.ts` | `src/utils/math.test.ts` |
| `src/api/handler.ts` | `src/api/handler.test.ts` |
| `lib/parser.ts` | `lib/parser.test.ts` |

## Example: full generation for a simple function

**Source: `src/utils/clamp.ts`**
```typescript
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
```

**Generated: `src/utils/clamp.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { fc } from '@fast-check/vitest';
import { clamp } from './clamp';

describe('clamp', () => {
  describe('boundary cases', () => {
    it('returns min when value is below min', () => {
      expect(clamp(-100, 0, 10)).toBe(0);
    });
    it('returns max when value is above max', () => {
      expect(clamp(100, 0, 10)).toBe(10);
    });
    it('handles NaN value', () => {
      const result = clamp(NaN, 0, 10);
      expect(Number.isNaN(result) || (result >= 0 && result <= 10)).toBe(true);
    });
    it('handles Infinity', () => {
      expect(clamp(Infinity, 0, 10)).toBe(10);
    });
    it('handles -Infinity', () => {
      expect(clamp(-Infinity, 0, 10)).toBe(0);
    });
    it('handles min === max', () => {
      expect(clamp(5, 3, 3)).toBe(3);
    });
  });

  describe('happy path', () => {
    it('returns value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });
  });

  describe('error path', () => {
    it('handles inverted range (min > max)', () => {
      // Document the actual behavior — do not assume
      const result = clamp(5, 10, 0);
      expect(typeof result).toBe('number');
    });
  });

  describe('behavioral contracts', () => {
    it.prop([
      fc.integer({ min: -1000, max: 1000 }),
      fc.integer({ min: -1000, max: 1000 }),
      fc.integer({ min: -1000, max: 1000 }),
    ])('result is always within [min, max] when min <= max', (value, a, b) => {
      const [min, max] = [Math.min(a, b), Math.max(a, b)];
      const result = clamp(value, min, max);
      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(max);
    });

    it.prop([fc.integer()])('returns value unchanged when already in range', (n) => {
      const result = clamp(n, n - 1, n + 1);
      expect(result).toBe(n);
    });

    it('is idempotent: clamping twice equals clamping once', () => {
      const result1 = clamp(clamp(50, 0, 10), 0, 10);
      const result2 = clamp(50, 0, 10);
      expect(result1).toBe(result2);
    });
  });
});
```

## Integration with Claude Code hooks

To run testgen automatically after every AI code write, add to `.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "npx testgen \"$FILE_PATH\" --auto --silent-if-tested",
        "description": "Auto-generate tests for new/modified source files"
      }
    ]
  }
}
```

- `--auto`: non-interactive, skip prompts
- `--silent-if-tested`: do nothing if a `.test.ts` already exists
- `--overwrite`: explicitly replace an existing generated test file
- `--merge`: update or append a protected generated block without deleting manual tests
- `--no-run`: generate tests without running Vitest
- `--invalid-input=no-throw|throw|skip`: choose generated invalid-input semantics
- `--extractor=auto|regex|typescript`: choose export extraction mode

## Project configuration

If the project has `.testgenrc`, `.testgenrc.json`, or `testgen.config.json`, respect it. Supported fields:

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

`invalidInputStrategy` can be `no-throw`, `throw`, or `skip`.
`merge` preserves manual tests by updating content inside `// <testgen:generated>` markers.
`extractor` can be `auto`, `regex`, or `typescript`.
