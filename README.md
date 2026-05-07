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

## Quick start

```bash
# Install
pnpm add -D @testgen/core vitest @fast-check/vitest

# Generate tests for a file
npx testgen src/utils/math.ts

# Dry run — print without writing
npx testgen src/utils/math.ts --dry-run
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
import { fc } from '@fast-check/vitest';
import { clamp } from './clamp';

describe('clamp', () => {
  describe('boundary cases', () => {
    it('handles value=NaN', () => { /* ... */ });
    it('handles value=Infinity', () => { /* ... */ });
    it('handles value=null', () => { /* ... */ });
    // ... 8 more boundary cases
  });

  describe('behavioral contracts', () => {
    it.prop([fc.integer(), fc.integer(), fc.integer()])(
      'result is always within [min, max] when min <= max',
      (value, a, b) => {
        const [min, max] = [Math.min(a, b), Math.max(a, b)];
        const result = clamp(value, min, max);
        expect(result).toBeGreaterThanOrEqual(min);
        expect(result).toBeLessThanOrEqual(max);
      }
    );
    it('is idempotent: clamping twice equals clamping once', () => { /* ... */ });
  });
});
```

---

## Claude Code integration

### As a skill

Copy `skill/testgen.md` to `~/.claude/agents/testgen.md`, then use `/testgen src/utils/math.ts` in any Claude Code session.

### As a PostToolUse hook

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

---

## CLI options

```
npx testgen <file.ts> [options]

Options:
  --auto              Non-interactive mode (skip all prompts)
  --silent-if-tested  Do nothing if a .test.ts already exists
  --dry-run           Print generated test file without writing it
```

---

## Repo structure

```
testgen/
├── skill/testgen.md          Claude Code skill
├── packages/
│   ├── core/                 Orchestration: extractor, generator, writer, reporter
│   └── typescript/           Vitest + fast-check adapter (coming in v0.2)
└── examples/
    └── basic-function/       Runnable demo
```

---

## Roadmap

- [x] Core: extractor, generator, writer, reporter
- [x] Claude Code skill
- [x] CLI (`npx testgen`)
- [x] CI workflow
- [ ] `packages/typescript` — full Vitest + fast-check integration
- [ ] Python adapter (Hypothesis)
- [ ] GitHub Action
- [ ] VS Code extension
- [ ] Mutation test integration (Stryker)

---

## Contributing

PRs welcome. Please open an issue first for anything beyond bug fixes.

---

## License

MIT
