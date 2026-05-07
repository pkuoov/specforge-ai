import { describe, expect, it } from 'vitest';
import { paramsToArbitraries, typeToFcArbitrary } from './fc-mapper.js';

describe('typeToFcArbitrary', () => {
  it('maps primitive and collection TypeScript types to fast-check arbitraries', () => {
    expect(typeToFcArbitrary('string').code).toBe('fc.string()');
    expect(typeToFcArbitrary('number[]').code).toBe('fc.array(fc.double({ noNaN: true }))');
    expect(typeToFcArbitrary('string | null').code).toBe(
      'fc.option(fc.string(), { nil: null })'
    );
  });

  it('wraps optional parameters with fc.option', () => {
    expect(
      paramsToArbitraries([{ name: 'count', type: 'number', optional: true }])
    ).toEqual(['fc.option(fc.double({ noNaN: true }))']);
  });
});
