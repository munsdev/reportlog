/**
 * Error tracking without Bugsink: a stand-in on loopback receives exactly
 * what would have left, and each test reads it.
 *
 * The promise under test: off unless a DSN is set, and an event never carries
 * an IP address, a full URL or a request body.
 */
import { framePath, scrubEvent, scrubText } from '@reportlog/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { browserEvent, createErrorTracker, releaseOf } from '../../src/telemetry/tracker.ts';
import { standInBugsink } from '../stand-in-bugsink.ts';
import type { StandInBugsink } from '../stand-in-bugsink.ts';

const TOKEN = 'k3Jd9QwPz7XvB2nM8rT5yL1aF4hS6uE0';
const config = (dsn?: string) => ({
  ...(dsn ? { ERROR_TRACKING_DSN: dsn } : {}),
  ERROR_TRACKING_ENVIRONMENT: 'test',
});

/** The event item of the one envelope a stand-in received. */
function onlyEvent(b: StandInBugsink): Record<string, unknown> {
  expect(b.received).toHaveLength(1);
  const [, itemHeader, payload] = b.received[0]?.items ?? [];
  expect(itemHeader).toMatchObject({ type: 'event' });
  return payload as Record<string, unknown>;
}

/** Everything a stand-in was sent, as one string, for "never anywhere" checks. */
const everything = (b: StandInBugsink) => JSON.stringify(b.received);

/** A browser envelope as Sentry's browser SDK writes one, with everything it might carry. */
function browserEnvelope(
  extra: Record<string, unknown> = {},
  dsn = 'https://k@elsewhere.example/9',
) {
  const event = {
    event_id: 'f'.repeat(32),
    timestamp: 1_760_000_000,
    platform: 'javascript',
    level: 'error',
    exception: {
      values: [
        {
          type: 'TypeError',
          value: `Cannot read properties of undefined at https://reports.example.org/file/confirm?token=${TOKEN}`,
          mechanism: { type: 'onerror', handled: false },
          stacktrace: {
            frames: [
              {
                filename: 'https://reports.example.org/assets/index-3f2a.js?v=1#x',
                function: 'confirm',
                lineno: 10,
                colno: 5,
                in_app: true,
                vars: { token: TOKEN },
              },
            ],
          },
        },
      ],
    },
    request: {
      url: `https://reports.example.org/file/confirm?token=${TOKEN}`,
      headers: { 'User-Agent': 'x', Referer: 'https://reports.example.org/mine' },
      data: { what: 'what the reporter typed' },
      cookies: { rl_session: 'secret' },
    },
    user: { ip_address: '203.0.113.9', email: 'reporter@example.org' },
    breadcrumbs: [{ category: 'fetch', data: { url: `/api/reports/confirm/${TOKEN}` } }],
    extra: { body: 'what the reporter typed' },
    server_name: 'laptop',
    tags: { route: '/file/confirm', secret: 'no' },
    ...extra,
  };
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: '2026-10-19T10:00:00Z', dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
    JSON.stringify({ type: 'session' }),
    JSON.stringify({ sid: 'abc', status: 'ok', attrs: { ip_address: '203.0.113.9' } }),
  ].join('\n');
}

let open: StandInBugsink[] = [];
async function bugsink() {
  const b = await standInBugsink();
  open.push(b);
  return b;
}
afterEach(async () => {
  await Promise.all(open.map((b) => b.close()));
  open = [];
});

describe('scrubbing free text', () => {
  it('takes out whole URLs, email and IP addresses, and tokens', () => {
    const out = scrubText(
      `GET https://x.org/confirm?token=${TOKEN} for reporter@example.org from 203.0.113.9 or 2001:db8::7 code ${TOKEN}`,
    );
    expect(out).toBe('GET [address] for [email] from [ip] or [ip] code [token]');
  });

  it('leaves times, words and short identifiers alone', () => {
    const text = 'at 12:30:45, Foo::bar failed in renderLogbookQuestionCard (index-3f2a.js)';
    expect(scrubText(text)).toBe(text);
  });

  it('keeps a frame’s path and drops its origin, query and fragment', () => {
    expect(framePath('https://reports.example.org/assets/a-1.js?v=2#y')).toBe('/assets/a-1.js');
    expect(framePath('/srv/reportlog/current/apps/api/src/app.ts')).toBe(
      '/srv/reportlog/current/apps/api/src/app.ts',
    );
  });
});

describe('what an event may carry', () => {
  it('keeps the error and drops the request, the user, breadcrumbs, extras and unknown tags', () => {
    const event = browserEvent(browserEnvelope());
    expect(event).not.toBeNull();
    const text = JSON.stringify(event);
    for (const gone of ['request', 'user', 'breadcrumbs', 'extra', 'server_name', 'vars']) {
      expect(Object.keys(event ?? {})).not.toContain(gone);
      expect(text).not.toContain(`"${gone}"`);
    }
    for (const never of [
      TOKEN,
      '203.0.113.9',
      'reporter@example.org',
      'what the reporter typed',
      'reports.example.org',
    ]) {
      expect(text).not.toContain(never);
    }
    expect(event?.tags).toEqual({ route: '/file/confirm' });
    expect(event?.exception.values[0]?.stacktrace?.frames[0]).toEqual({
      filename: '/assets/index-3f2a.js',
      function: 'confirm',
      lineno: 10,
      colno: 5,
      in_app: true,
    });
  });

  it('is not an error event without an exception, and not one event with two', () => {
    expect(scrubEvent({ message: 'hello' })).toBeNull();
    expect(browserEvent('not an envelope')).toBeNull();
    const two = browserEnvelope().split('\n');
    expect(browserEvent([...two.slice(0, 3), two[1], two[2]].join('\n'))).toBeNull();
  });
});

describe('the tracker', () => {
  it('is off, and sends nothing, without a DSN', async () => {
    let calls = 0;
    const tracker = createErrorTracker({
      config: config(),
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response('{}'));
      },
    });
    expect(tracker.on).toBe(false);
    tracker.capture(new Error('boom'));
    expect(await tracker.relay(browserEnvelope())).toBe('off');
    await tracker.flush();
    expect(calls).toBe(0);
  });

  it('sends the server’s error to the DSN’s project, with the route pattern and nothing of the request', async () => {
    const b = await bugsink();
    const tracker = createErrorTracker({ config: config(b.dsn), release: 'a'.repeat(40) });
    expect(tracker.on).toBe(true);
    tracker.capture(
      new Error(`failed to reach https://s3.example/b?X-Amz-Signature=${TOKEN} for 203.0.113.9`),
      {
        side: 'api',
        method: 'POST',
        route: '/api/reports/confirm/:token',
      },
    );
    expect(await tracker.flush(5000)).toBe(true);

    expect(b.received[0]?.path).toMatch(/^\/api\/1\/envelope\/\?/);
    const event = onlyEvent(b);
    expect(event).toMatchObject({
      platform: 'node',
      environment: 'test',
      release: 'a'.repeat(40),
      tags: { side: 'api', method: 'POST', route: '/api/reports/confirm/:token' },
      exception: { values: [{ type: 'Error', value: 'failed to reach [address] for [ip]' }] },
    });
    const frames = (event.exception as { values: { stacktrace: { frames: unknown[] } }[] })
      .values[0]?.stacktrace.frames;
    expect(frames?.length).toBeGreaterThan(0);
    for (const key of ['request', 'user', 'breadcrumbs', 'server_name', 'contexts.device']) {
      expect(Object.keys(event)).not.toContain(key);
    }
    expect(everything(b)).not.toContain(TOKEN);
    expect(everything(b)).not.toContain('203.0.113.9');
    // Nothing of a visitor rides along on the request itself either.
    expect(Object.keys(b.received[0]?.headers ?? {})).not.toContain('x-forwarded-for');
    expect(Object.keys(b.received[0]?.headers ?? {})).not.toContain('cookie');
  });

  it('relays the website’s error under its own DSN, never the one the envelope names', async () => {
    const b = await bugsink();
    const elsewhere = await bugsink();
    const tracker = createErrorTracker({ config: config(b.dsn), release: 'b'.repeat(40) });
    expect(await tracker.relay(browserEnvelope({}, elsewhere.dsn))).toBe('sent');
    await tracker.flush(5000);

    expect(elsewhere.received).toEqual([]);
    const event = onlyEvent(b);
    // The session item that rode along was dropped.
    expect(b.received[0]?.items).toHaveLength(3);
    expect(event).toMatchObject({
      platform: 'javascript',
      environment: 'test',
      release: 'b'.repeat(40),
      tags: { route: '/file/confirm', side: 'website' },
    });
    for (const never of [
      TOKEN,
      '203.0.113.9',
      'reporter@example.org',
      'what the reporter typed',
      'reports.example.org',
      'elsewhere',
    ]) {
      expect(everything(b)).not.toContain(never);
    }
  });

  it('relays nothing that is not an error event', async () => {
    const b = await bugsink();
    const tracker = createErrorTracker({ config: config(b.dsn) });
    const session = [
      JSON.stringify({ sent_at: '2026-10-19T10:00:00Z' }),
      JSON.stringify({ type: 'session' }),
      JSON.stringify({ sid: 'abc', status: 'ok' }),
    ].join('\n');
    expect(await tracker.relay(session)).toBe('not-an-error');
    expect(await tracker.relay('')).toBe('not-an-error');
    await tracker.flush(1000);
    expect(b.received).toEqual([]);
  });

  it('never throws when Bugsink is down', async () => {
    const b = await bugsink();
    await b.close();
    open = [];
    const tracker = createErrorTracker({ config: config(b.dsn) });
    tracker.capture(new Error('boom'));
    await expect(tracker.relay(browserEnvelope())).resolves.toBe('unreachable');
    await expect(tracker.flush(2000)).resolves.toBeTypeOf('boolean');
  });

  it('names the release from REVISION, and no release in a checkout', () => {
    expect(releaseOf(new URL('file:///nonexistent/REVISION'))).toBeUndefined();
  });
});
