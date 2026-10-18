import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { withDatabase } from '../../src/db/throwaway.ts';

describe('configuration', () => {
  it('applies defaults and names what is missing', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x/y' })).toMatchObject({
      PORT: 3000,
      PUBLIC_REF_PREFIX: 'RL-',
    });
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'x', PUBLIC_REF_PREFIX: 'rl' })).toThrow(
      /PUBLIC_REF_PREFIX/,
    );
  });
});

describe('withDatabase', () => {
  it.each([
    ['postgres://u@/a?host=/run/pg&port=5446', 'postgres://u@/b?host=/run/pg&port=5446'],
    ['postgres://u:p@h:5432/a', 'postgres://u:p@h:5432/b'],
    ['postgresql://h', 'postgresql://h/b'],
  ])('%s', (input, out) => {
    expect(withDatabase(input, 'b')).toBe(out);
  });
});
