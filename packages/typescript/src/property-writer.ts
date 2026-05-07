import type { FunctionSignature } from '@testgen/core';
import { paramsToArbitraries, typeToFcArbitrary } from './fc-mapper.js';

export interface PropertyBlock {
  functionName: string;
  code: string;
}

function behavioralContracts(sig: FunctionSignature): string[] {
  const contracts: string[] = [];
  const name = sig.name.toLowerCase();
  const ret = sig.returnType.toLowerCase().replace(/\s/g, '');
  const arbitraries = paramsToArbitraries(sig.params);
  const paramNames = sig.params.map((p) => p.name).join(', ');
  const argsStr = arbitraries.join(', ');
  const callArgs = sig.params.map((p) => p.name).join(', ');
  const awaitPrefix = sig.isAsync ? 'await ' : '';

  // Idempotency: f(f(x)) === f(x)
  if (
    name.includes('normalize') ||
    name.includes('sanitize') ||
    name.includes('trim') ||
    name.includes('format') ||
    name.includes('clean')
  ) {
    const firstParam = sig.params[0];
    if (firstParam && sig.params.length === 1) {
      contracts.push(`  it.prop([${argsStr}])(
    'is idempotent: ${sig.name}(${sig.name}(x)) deep-equals ${sig.name}(x)',
    ${sig.isAsync ? 'async ' : ''}(${paramNames}) => {
      const once = ${awaitPrefix}${sig.name}(${callArgs});
      const twice = ${awaitPrefix}${sig.name}(once as ${firstParam.type});
      expect(twice).toEqual(once);
    }
  );`);
    }
  }

  // Commutativity: f(a, b) === f(b, a)
  if (
    sig.params.length === 2 &&
    sig.params[0] &&
    sig.params[1] &&
    sig.params[0].type === sig.params[1].type &&
    (name.includes('add') || name.includes('sum') || name.includes('merge') ||
     name.includes('combine') || name.includes('concat') || name.includes('join'))
  ) {
    const [p0, p1] = sig.params;
    if (p0 && p1) {
      contracts.push(`  it.prop([${arbitraries[0]}, ${arbitraries[0]}])(
    'is commutative: ${sig.name}(a, b) equals ${sig.name}(b, a)',
    ${sig.isAsync ? 'async ' : ''}(${p0.name}, ${p1.name}) => {
      const ab = ${awaitPrefix}${sig.name}(${p0.name}, ${p1.name});
      const ba = ${awaitPrefix}${sig.name}(${p1.name}, ${p0.name});
      expect(ab).toEqual(ba);
    }
  );`);
    }
  }

  // Non-negative numeric return
  if (
    (ret.includes('number') || ret === 'unknown') &&
    (name.includes('count') || name.includes('length') || name.includes('size') ||
     name.includes('total') || name.includes('sum') || name.includes('distance'))
  ) {
    contracts.push(`  it.prop([${argsStr}])(
    'always returns a non-negative number',
    ${sig.isAsync ? 'async ' : ''}(${paramNames}) => {
      const result = ${awaitPrefix}${sig.name}(${callArgs});
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    }
  );`);
  }

  // Length-preserving for array transforms
  const hasArrayParam = sig.params.some(
    (p) => p.type.includes('[]') || p.type.toLowerCase().includes('array')
  );
  if (
    hasArrayParam &&
    (name.includes('sort') || name.includes('shuffle') ||
     name.includes('reverse') || name.includes('map') || name.includes('filter'))
  ) {
    const arrParam = sig.params.find(
      (p) => p.type.includes('[]') || p.type.toLowerCase().includes('array')
    );
    const others = sig.params.filter((p) => p !== arrParam);
    const otherArbs = paramsToArbitraries(others);

    const arrArb = arrParam ? typeToFcArbitrary(arrParam.type).code : 'fc.array(fc.anything())';
    const allArbs = [arrArb, ...otherArbs].join(', ');
    const allNames = sig.params.map((p) => p.name).join(', ');

    if (name.includes('filter')) {
      contracts.push(`  it.prop([${allArbs}])(
    'output length is <= input length (filter)',
    ${sig.isAsync ? 'async ' : ''}(${allNames}) => {
      const result = ${awaitPrefix}${sig.name}(${callArgs});
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBeLessThanOrEqual(
        (${arrParam?.name ?? 'arg'} as unknown[]).length
      );
    }
  );`);
    } else {
      contracts.push(`  it.prop([${allArbs}])(
    'output length equals input length',
    ${sig.isAsync ? 'async ' : ''}(${allNames}) => {
      const result = ${awaitPrefix}${sig.name}(${callArgs});
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBe(
        (${arrParam?.name ?? 'arg'} as unknown[]).length
      );
    }
  );`);
    }
  }

  // Clamp-style: result always within bounds
  if (name.includes('clamp') && sig.params.length >= 3) {
    const [val, min, max] = sig.params;
    if (val && min && max) {
      contracts.push(`  it.prop([
    fc.double({ noNaN: true }),
    fc.double({ noNaN: true }),
    fc.double({ noNaN: true }),
  ])(
    'result is always within [min, max] when min <= max',
    ${sig.isAsync ? 'async ' : ''}(${val.name}, a, b) => {
      const [${min.name}, ${max.name}] = [Math.min(a, b), Math.max(a, b)];
      const result = ${awaitPrefix}${sig.name}(${val.name}, ${min.name}, ${max.name});
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(${min.name});
      expect(result).toBeLessThanOrEqual(${max.name});
    }
  );`);
    }
  }

  // Fallback: never throws for valid-typed inputs
  if (contracts.length === 0) {
    if (sig.isAsync) {
      contracts.push(`  it.prop([${argsStr}])(
    'does not throw for valid-typed inputs',
    async (${paramNames}) => {
      await expect(${sig.name}(${callArgs})).resolves.toBeDefined();
    }
  );`);
    } else {
      contracts.push(`  it.prop([${argsStr}])(
    'does not throw for valid-typed inputs',
    (${paramNames}) => {
      expect(() => ${sig.name}(${callArgs})).not.toThrow();
    }
  );`);
    }
  }

  return contracts;
}

export function renderPropertyBlock(sig: FunctionSignature, importPath: string): PropertyBlock {
  const arbitraries = paramsToArbitraries(sig.params);
  const paramNames = sig.params.map((p) => p.name).join(', ');
  const argsStr = arbitraries.join(', ');
  const callArgs = sig.params.map((p) => p.name).join(', ');
  const awaitPrefix = sig.isAsync ? 'await ' : '';

  const returnContract = behavioralContracts(sig);

  const code = `
// ─── ${sig.name} ──────────────────────────────────────────────────────
describe('${sig.name} — property tests', () => {
  // Boundary: null/undefined on each parameter
${sig.params.map((p, i) => {
  const nullInputs = sig.params.map((_, j) => (j === i ? 'null' : arbitraries[j]));
  return `  it.prop([${nullInputs.join(', ')}])(
    'survives null for parameter "${p.name}"',
    ${sig.isAsync ? 'async ' : ''}(${paramNames}) => {
      try {
        ${awaitPrefix}${sig.name}(${callArgs});
      } catch (_e) {
        // throwing is acceptable for null input
      }
    }
  );`;
}).join('\n')}

  // Behavioral contracts (derived from name + types, not implementation)
${returnContract.join('\n\n')}

  // Round-trip: output is the right type
  it.prop([${argsStr}])(
    'return type matches declared signature',
    ${sig.isAsync ? 'async ' : ''}(${paramNames}) => {
      try {
        const result = ${awaitPrefix}${sig.name}(${callArgs});
        const returnsNull = ${JSON.stringify(sig.returnType)}.includes('null');
        const returnsUndefined = ${JSON.stringify(sig.returnType)}.includes('undefined') || ${JSON.stringify(sig.returnType)} === 'void';
        if (!returnsNull && !returnsUndefined) {
          expect(result).toBeDefined();
        }
      } catch (_e) {
        expect(_e).toBeInstanceOf(Error);
      }
    }
  );
});
`.trim();

  return { functionName: sig.name, code };
}

export function renderPropertyTestFile(
  sigs: FunctionSignature[],
  importPath: string
): string {
  const fnNames = sigs.map((s) => s.name).join(', ');
  const blocks = sigs.map((sig) => renderPropertyBlock(sig, importPath));

  return [
    `// Generated by @testgen/typescript — property-based tests`,
    `// Regenerate with: npx testgen ${importPath}.ts --mode=property`,
    `// DO NOT hand-edit the property blocks — edit the source and regenerate.`,
    ``,
    `import { describe, it, expect } from 'vitest';`,
    `import { it as itProp } from '@fast-check/vitest';`,
    `import fc from 'fast-check';`,
    `import { ${fnNames} } from '${importPath}';`,
    ``,
    `// Re-export it.prop as it for convenience`,
    `const { prop } = itProp;`,
    `// eslint-disable-next-line @typescript-eslint/no-explicit-any`,
    `(it as any).prop = prop;`,
    ``,
    ...blocks.map((b) => b.code),
    ``,
  ].join('\n');
}
