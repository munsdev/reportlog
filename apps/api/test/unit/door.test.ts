/**
 * The door's parts that need no database: the per-address limits and the
 * daily key they count under, the start token, and E4's limits as the builder
 * takes them. The routes, the puzzle and the refusals are in
 * test/db/door.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { clientHasher } from '../../src/door/clients.ts';
import { rateLimiter } from '../../src/door/limits.ts';
import { checkStart, issueStart } from '../../src/door/start.ts';
import { settingsFor } from '../../src/logbooks/logbooks.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('rate limits per address', () => {
  const setup = () => {
    let t = Date.UTC(2026, 10, 3, 9, 0, 0);
    const clock = {
      now: () => t,
      advance: (ms: number) => {
        t += ms;
      },
    };
    const hasher = clientHasher(clock.now);
    const limits = rateLimiter(
      hasher,
      { submitsPerMinute: 2, submitsPerHour: 5, requestsPerMinute: 3 },
      clock.now,
    );
    return { clock, hasher, limits };
  };

  it('per minute: over the limit is refused, and the next minute starts again', () => {
    const { clock, limits } = setup();
    expect(limits.submit('a')).toBeNull();
    expect(limits.submit('a')).toBeNull();
    expect(limits.submit('a')).toBe('rate_minute');
    expect(limits.submit('b')).toBeNull();
    clock.advance(MIN);
    expect(limits.submit('a')).toBeNull();
  });

  it('per hour: a slow stream under the minute limit is still stopped by the hour', () => {
    const { clock, limits } = setup();
    const got: (string | null)[] = [];
    for (let i = 0; i < 7; i += 1) {
      got.push(limits.submit('slow'));
      clock.advance(MIN);
    }
    expect(got).toEqual([null, null, null, null, null, 'rate_hour', 'rate_hour']);
    clock.advance(HOUR);
    expect(limits.submit('slow')).toBeNull();
  });

  it('requests have their own limit, and only the one that crosses it is "first"', () => {
    const { limits } = setup();
    const seen = [1, 2, 3, 4, 5].map(() => limits.request('r'));
    expect(seen.map((s) => s.over)).toEqual([false, false, false, true, true]);
    expect(seen.map((s) => s.first)).toEqual([false, false, false, true, false]);
    // Submissions are counted apart.
    expect(limits.submit('r')).toBeNull();
  });

  it('at midnight the key changes, every hash with it, and the counters are dropped', () => {
    const { clock, hasher, limits } = setup();
    const before = hasher.of('198.51.100.7');
    expect(hasher.of('198.51.100.7')).toBe(before);
    expect(before).not.toContain('198.51.100.7');
    limits.submit('x');
    limits.submit('x');
    expect(limits.submit('x')).toBe('rate_minute');
    clock.advance(15 * HOUR);
    hasher.tick();
    expect(hasher.of('198.51.100.7')).not.toBe(before);
    // A new day: yesterday's counts are gone, not merely unreachable.
    expect(limits.submit('x')).toBeNull();
  });
});

describe('the start token', () => {
  const key = Buffer.alloc(32, 3);
  const t = Date.UTC(2026, 10, 3, 9, 0, 0);

  it('carries a moment and its signature, nothing else', () => {
    expect(issueStart(key, t)).toMatch(new RegExp(`^${String(t)}\\.[A-Za-z0-9_-]{43}$`));
  });

  it('is taken once the minimum has passed, and refused before', () => {
    const token = issueStart(key, t);
    expect(checkStart(key, token, 3000, t + 2999)).toBe('too_fast');
    expect(checkStart(key, token, 3000, t + 3000)).toBeNull();
    expect(checkStart(key, token, 0, t)).toBeNull();
  });

  it('a token signed with another key, altered, from the future or missing is refused', () => {
    const token = issueStart(key, t);
    expect(checkStart(Buffer.alloc(32, 4), token, 0, t + 9000)).toBe('start_missing');
    const [, mac] = token.split('.');
    expect(checkStart(key, `${String(t - 60_000)}.${mac ?? ''}`, 0, t + 9000)).toBe(
      'start_missing',
    );
    expect(checkStart(key, issueStart(key, t + 60_000), 0, t)).toBe('start_missing');
    expect(checkStart(key, undefined, 0, t)).toBe('start_missing');
    expect(checkStart(key, 12, 0, t)).toBe('start_missing');
  });
});

describe('E4 in the builder', () => {
  it('a date question keeps its limits in the written form, and has no key for one not set', () => {
    expect(settingsFor('date', { earliest: '2026-09-18', latest: '2026-11-10' })).toEqual({
      earliest: '2026-09-18',
      latest: '2026-11-10',
    });
    expect(settingsFor('date', {})).toEqual({});
    expect('earliest' in settingsFor('date', { earliest: '' })).toBe(false);
    expect(settingsFor('time', { earliest: '7:00' })).toEqual({ earliest: '07:00:00' });
    expect(settingsFor('datetime', { latest: '2026-11-03T20:00-05:00' })).toEqual({
      latest: '2026-11-04T01:00:00.000Z',
    });
  });

  it('refuses a limit that is not a day, a time or a moment with its offset, and earliest after latest', () => {
    const refuses = (kind: string, s: Record<string, string>) => {
      expect(() => settingsFor(kind, s), JSON.stringify(s)).toThrow(/earliest or latest/);
    };
    refuses('date', { earliest: 'next week' });
    refuses('date', { earliest: '2026-02-31' });
    refuses('time', { latest: '25:00' });
    refuses('datetime', { earliest: '2026-11-03T07:00' });
    refuses('date', { earliest: '2026-11-10', latest: '2026-09-18' });
    // Not a setting a choice reads.
    expect(() => settingsFor('choice_one', { options: ['a'], earliest: '2026-01-01' })).toThrow();
  });
});
