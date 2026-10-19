import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import {
  createCaptureSender,
  createEmailSender,
  createScalewaySender,
  emailReadiness,
  linkIn,
  readCaptured,
} from '../../src/email/index.ts';
import { mailTest } from '../../src/email/mail-test.ts';

const MESSAGE = {
  to: 'reporter@example.org',
  subject: 'Confirm your report',
  text: 'Confirm it here: https://reports.example.org/confirm/abc123\n\nThank you.',
};

const PROJECT = '6f1c2a4e-8b3d-4c5e-9a7f-0123456789ab';

/** A fetch that records what it was asked and answers as told. */
function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: string }[] = [];
  const fn: typeof fetch = (url, init) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url: href, init: init ?? {}, body });
    return Promise.resolve(answer());
  };
  return { fn, calls };
}

const scaleway = (f: typeof fetch) =>
  createScalewaySender({
    secretKey: 'secret-key',
    projectId: PROJECT,
    region: 'fr-par',
    from: { email: 'reports@example.org', name: 'Example Reports' },
    fetch: f,
  });

describe('the Scaleway sender', () => {
  it('sends one message to the regional API, with the key in a header and nowhere else', async () => {
    const f = fakeFetch(() => Response.json({ emails: [{ id: 'em-1' }] }));
    const result = await scaleway(f.fn).send({ ...MESSAGE, html: '<p>Confirm</p>' });

    expect(result).toEqual({ sent: true, transport: 'scaleway', id: 'em-1' });
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0];
    expect(call?.url).toBe(
      'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails',
    );
    expect(call?.init.method).toBe('POST');
    expect((call?.init.headers as Record<string, string>)['x-auth-token']).toBe('secret-key');
    const body: unknown = JSON.parse(call?.body ?? '');
    expect(body).toEqual({
      from: { email: 'reports@example.org', name: 'Example Reports' },
      to: [{ email: 'reporter@example.org' }],
      subject: 'Confirm your report',
      text: MESSAGE.text,
      html: '<p>Confirm</p>',
      project_id: PROJECT,
    });
    expect(call?.body ?? '').not.toContain('secret-key');
  });

  it('leaves html out entirely when there is none', async () => {
    const f = fakeFetch(() => Response.json({ emails: [] }));
    await scaleway(f.fn).send(MESSAGE);
    expect(JSON.parse(f.calls[0]?.body ?? '')).not.toHaveProperty('html');
  });

  it('calls a 4xx a rejection and a 5xx or 429 unreachable, never naming the recipient', async () => {
    const refused = await scaleway(
      fakeFetch(() => new Response('{"message":"domain not verified"}', { status: 400 })).fn,
    ).send(MESSAGE);
    expect(refused).toMatchObject({ sent: false, reason: 'rejected' });
    expect(refused.sent || refused.detail).toContain('domain not verified');

    for (const status of [429, 500, 503]) {
      const r = await scaleway(fakeFetch(() => new Response('busy', { status })).fn).send(MESSAGE);
      expect(r).toMatchObject({ sent: false, reason: 'unreachable' });
    }
    for (const r of [refused]) expect(JSON.stringify(r)).not.toContain(MESSAGE.to);
  });

  it('turns a network failure into a result rather than a throw', async () => {
    const f = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    expect(await scaleway(f).send(MESSAGE)).toMatchObject({ sent: false, reason: 'unreachable' });
  });

  it('refuses an address no provider would take without asking the provider', async () => {
    const f = fakeFetch(() => Response.json({}));
    for (const to of [
      '',
      'nobody',
      'a@b',
      'two@example.org, three@example.org',
      'x@y.z\nBcc: v@w.org',
    ]) {
      expect(await scaleway(f.fn).send({ ...MESSAGE, to })).toMatchObject({ reason: 'invalid' });
    }
    expect(f.calls).toHaveLength(0);
  });

  it('throws on a programming error: no subject, a two-line subject, no text', async () => {
    const s = scaleway(fakeFetch(() => Response.json({})).fn);
    await expect(s.send({ ...MESSAGE, subject: ' ' })).rejects.toThrow(/subject/);
    await expect(s.send({ ...MESSAGE, subject: 'a\nBcc: x@y.org' })).rejects.toThrow(/one line/);
    await expect(s.send({ ...MESSAGE, text: '' })).rejects.toThrow(/plain-text/);
  });
});

describe('the capture sender (the test double)', () => {
  it('keeps every message and finds the newest to an address', async () => {
    const mail = createCaptureSender();
    await mail.send(MESSAGE);
    await mail.send({ ...MESSAGE, subject: 'Second' });
    await mail.send({ ...MESSAGE, to: 'other@example.org' });
    expect(mail.outbox).toHaveLength(3);
    expect(mail.lastTo('reporter@example.org')?.subject).toBe('Second');
    expect(linkIn(mail.lastTo('reporter@example.org'))).toBe(
      'https://reports.example.org/confirm/abc123',
    );
    mail.clear();
    expect(mail.outbox).toHaveLength(0);
  });

  it('fails the next send on request, as a provider would, then recovers', async () => {
    const mail = createCaptureSender();
    mail.failNext('unreachable');
    expect(await mail.send(MESSAGE)).toMatchObject({ sent: false, reason: 'unreachable' });
    expect(await mail.send(MESSAGE)).toMatchObject({ sent: true });
    expect(mail.outbox).toHaveLength(1);
  });

  it('writes each message to a directory a browser test can read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-capture-'));
    const mail = createCaptureSender({ dir });
    await mail.send({ ...MESSAGE, subject: 'First' });
    await mail.send({ ...MESSAGE, subject: 'Newest' });
    await mail.send({ ...MESSAGE, to: 'other@example.org' });
    expect(readdirSync(dir)).toHaveLength(3);
    expect(readCaptured(dir, 'reporter@example.org')?.subject).toBe('Newest');
    expect(readCaptured(dir, 'nobody@example.org')).toBeUndefined();
    expect(readCaptured(join(dir, 'missing'), 'reporter@example.org')).toBeUndefined();
  });
});

describe('choosing a sender', () => {
  const base = { DATABASE_URL: 'postgres://x/y' };

  it('is off unless told otherwise, and off logs the subject and nothing else', async () => {
    const lines: string[] = [];
    const sender = createEmailSender(loadConfig(base), (l) => lines.push(l));
    expect(sender.transport).toBe('off');
    expect(await sender.send(MESSAGE)).toMatchObject({ sent: false, reason: 'not-configured' });
    expect(lines.join('\n')).toContain('Confirm your report');
    expect(lines.join('\n')).not.toContain(MESSAGE.to);
    expect(lines.join('\n')).not.toContain('abc123');
  });

  it('builds the sender the configuration names', () => {
    expect(createEmailSender(loadConfig({ ...base, EMAIL_TRANSPORT: 'capture' })).transport).toBe(
      'capture',
    );
    const c = loadConfig({
      ...base,
      EMAIL_TRANSPORT: 'scaleway',
      SCALEWAY_SECRET_KEY: 'k',
      SCALEWAY_PROJECT_ID: PROJECT,
      EMAIL_FROM_ADDRESS: 'reports@example.org',
    });
    expect(createEmailSender(c).transport).toBe('scaleway');
  });

  it('refuses a half-configured Scaleway transport at start, naming what is missing', () => {
    expect(() => loadConfig({ ...base, EMAIL_TRANSPORT: 'scaleway' })).toThrow(
      /SCALEWAY_SECRET_KEY[\s\S]*SCALEWAY_PROJECT_ID[\s\S]*EMAIL_FROM_ADDRESS/,
    );
  });

  it('says a server on off or capture cannot deliver mail', () => {
    expect(emailReadiness(loadConfig(base)).ok).toBe(false);
    expect(emailReadiness(loadConfig({ ...base, EMAIL_TRANSPORT: 'capture' })).ok).toBe(false);
  });
});

describe('mail-test', () => {
  const config = loadConfig({ DATABASE_URL: 'postgres://x/y', EMAIL_TRANSPORT: 'capture' });

  it('sends one message to the address given and says accepted is not delivered', async () => {
    const mail = createCaptureSender();
    const lines: string[] = [];
    expect(await mailTest(config, mail, 'me@example.org', (l) => lines.push(l))).toBe(0);
    expect(mail.outbox).toHaveLength(1);
    expect(lines.join('\n')).toMatch(/spam/);
  });

  it('sends nothing without a usable address', async () => {
    const mail = createCaptureSender();
    expect(await mailTest(config, mail, undefined, () => undefined)).toBe(2);
    expect(await mailTest(config, mail, 'nobody', () => undefined)).toBe(2);
    expect(mail.outbox).toHaveLength(0);
  });

  it('fails when the provider refuses', async () => {
    const mail = createCaptureSender();
    mail.failNext('rejected');
    expect(await mailTest(config, mail, 'me@example.org', () => undefined)).toBe(1);
  });
});
