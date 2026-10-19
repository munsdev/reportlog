/**
 * The website's error reporting (src/features/telemetry/), with fetch
 * stubbed so each test sees every request the page would have made.
 *
 * The promises: nothing is asked until something breaks; nothing is sent
 * when the server says error tracking is off; and what is sent goes to this
 * site's relay, carrying neither the page's address nor anything the
 * visitor typed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api.ts';
import { reportError, resetErrorReporting } from '@/features/telemetry/report.ts';

const TOKEN = 'k3Jd9QwPz7XvB2nM8rT5yL1aF4hS6uE0';

interface Seen {
  url: string;
  method: string;
  body: string;
}
let seen: Seen[] = [];

function stubFetch(errors: boolean) {
  const impl = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const body = url.endsWith('/api/telemetry') ? { errors } : { relayed: true };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  vi.stubGlobal('fetch', vi.fn(impl));
}

/** Wait until `n` requests were made, or fail. */
async function requests(n: number): Promise<Seen[]> {
  await vi.waitFor(() => {
    expect(seen.length).toBeGreaterThanOrEqual(n);
  });
  return seen;
}

beforeEach(() => {
  seen = [];
  resetErrorReporting();
  window.history.pushState({}, '', `/file/confirm?token=${TOKEN}`);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reporting the website’s errors', () => {
  it('asks nothing until an error happens', async () => {
    stubFetch(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([]);
  });

  it('asks once, and sends nothing, when error tracking is off', async () => {
    stubFetch(false);
    reportError(new Error('first'));
    await requests(1);
    reportError(new Error('second'));
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['GET /api/telemetry']);
  });

  it('sends to this site’s relay, without the address or anything typed', async () => {
    stubFetch(true);
    const err = new Error(`could not confirm ${window.location.href}`);
    reportError(err);
    const [ask, sent] = await requests(2);
    expect(ask?.url).toBe('/api/telemetry');
    expect(sent?.method).toBe('POST');
    // Same origin: a path, never another host.
    expect(sent?.url).toBe('/api/telemetry/errors');
    const lines = (sent?.body ?? '').split('\n').filter(Boolean);
    const event = JSON.parse(lines[2] ?? '{}') as Record<string, unknown>;
    expect(event).toMatchObject({
      platform: 'javascript',
      exception: { values: [{ type: 'Error', value: 'could not confirm [address]' }] },
    });
    for (const key of ['request', 'user', 'breadcrumbs', 'extra']) {
      expect(Object.keys(event)).not.toContain(key);
    }
    expect(sent?.body).not.toContain(TOKEN);
    expect(sent?.body).not.toContain(window.location.host);
  });

  it('does not report a refusal the page already shows', async () => {
    stubFetch(true);
    reportError(new ApiRequestError(404, 'not_found', 'There is no report with that reference.'));
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([]);
  });
});
