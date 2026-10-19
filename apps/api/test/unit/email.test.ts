import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { createMailer, emailReadiness } from '../../src/email/index.ts';
import { mailTest } from '../../src/email/mail-test.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import { MailNotSent, scalewayMailer } from '../../src/email/scaleway.ts';
import type { ScalewayMailer } from '../../src/email/scaleway.ts';

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
  scalewayMailer({
    secretKey: 'secret-key',
    projectId: PROJECT,
    region: 'fr-par',
    from: { email: 'reports@example.org', name: 'Example Reports' },
    fetch: f,
  });

describe('the Scaleway mailer', () => {
  it('sends one plain-text message to the regional API, with the key in a header and nowhere else', async () => {
    const f = fakeFetch(() => Response.json({ emails: [{ id: 'em-1' }] }));
    expect(await scaleway(f.fn).trySend(MESSAGE)).toEqual({ sent: true, id: 'em-1' });

    expect(f.calls).toHaveLength(1);
    const call = f.calls[0];
    expect(call?.url).toBe(
      'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails',
    );
    expect(call?.init.method).toBe('POST');
    expect((call?.init.headers as Record<string, string>)['x-auth-token']).toBe('secret-key');
    expect(JSON.parse(call?.body ?? '')).toEqual({
      from: { email: 'reports@example.org', name: 'Example Reports' },
      to: [{ email: 'reporter@example.org' }],
      subject: 'Confirm your report',
      text: MESSAGE.text,
      project_id: PROJECT,
    });
    expect(call?.body).not.toContain('secret-key');
  });

  it('as a Mailer, resolves when sent', async () => {
    const f = fakeFetch(() => Response.json({ emails: [] }));
    await expect(scaleway(f.fn).send(MESSAGE)).resolves.toBeUndefined();
  });

  it('calls a 4xx a rejection and a 5xx or 429 unreachable, never naming the recipient', async () => {
    const refused = await scaleway(
      fakeFetch(() => new Response('{"message":"domain not verified"}', { status: 400 })).fn,
    ).trySend(MESSAGE);
    expect(refused).toMatchObject({ sent: false, reason: 'rejected' });
    expect(JSON.stringify(refused)).toContain('domain not verified');
    expect(JSON.stringify(refused)).not.toContain(MESSAGE.to);

    for (const status of [429, 500, 503]) {
      const r = await scaleway(fakeFetch(() => new Response('busy', { status })).fn).trySend(
        MESSAGE,
      );
      expect(r).toMatchObject({ sent: false, reason: 'unreachable' });
    }
  });

  it('as a Mailer, throws MailNotSent with the reason and without the address or body', async () => {
    const m = scaleway(fakeFetch(() => new Response('quota exceeded', { status: 403 })).fn);
    const err: unknown = await m.send(MESSAGE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailNotSent);
    expect((err as MailNotSent).reason).toBe('rejected');
    expect((err as MailNotSent).message).toContain('quota exceeded');
    expect((err as MailNotSent).message).not.toContain(MESSAGE.to);
    expect((err as MailNotSent).message).not.toContain('abc123');
  });

  it('turns a network failure into a result rather than a crash', async () => {
    const f = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    expect(await scaleway(f).trySend(MESSAGE)).toMatchObject({
      sent: false,
      reason: 'unreachable',
    });
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
      expect(await scaleway(f.fn).trySend({ ...MESSAGE, to })).toMatchObject({ reason: 'invalid' });
    }
    expect(f.calls).toHaveLength(0);
  });

  it('throws on a programming error: no subject, a two-line subject, no body', async () => {
    const s = scaleway(fakeFetch(() => Response.json({})).fn);
    await expect(s.trySend({ ...MESSAGE, subject: ' ' })).rejects.toThrow(/subject/);
    await expect(s.trySend({ ...MESSAGE, subject: 'a\nBcc: x@y.org' })).rejects.toThrow(/one line/);
    await expect(s.trySend({ ...MESSAGE, text: '' })).rejects.toThrow(/body/);
  });
});

describe('choosing a mailer', () => {
  const base = { DATABASE_URL: 'postgres://x/y' };
  const scalewayConfig = {
    ...base,
    EMAIL_TRANSPORT: 'scaleway',
    SCALEWAY_SECRET_KEY: 'k',
    SCALEWAY_PROJECT_ID: PROJECT,
    EMAIL_FROM_ADDRESS: 'reports@example.org',
  };

  it('is the standard-error fallback unless told otherwise', () => {
    expect('trySend' in createMailer(loadConfig(base))).toBe(false);
  });

  it('is Scaleway when configured, and the outbox whenever MAIL_OUTBOX is set', () => {
    expect('trySend' in createMailer(loadConfig(scalewayConfig))).toBe(true);
    expect(
      'trySend' in createMailer(loadConfig({ ...scalewayConfig, MAIL_OUTBOX: '/tmp/x' })),
    ).toBe(false);
  });

  it('refuses a half-configured Scaleway transport at start, naming what is missing', () => {
    expect(() => loadConfig({ ...base, EMAIL_TRANSPORT: 'scaleway' })).toThrow(
      /SCALEWAY_SECRET_KEY[\s\S]*SCALEWAY_PROJECT_ID[\s\S]*EMAIL_FROM_ADDRESS/,
    );
  });

  it('says mail on off, or into an outbox, is not delivered', () => {
    expect(emailReadiness(loadConfig(base)).ok).toBe(false);
    expect(emailReadiness(loadConfig({ ...scalewayConfig, MAIL_OUTBOX: '/tmp/x' })).ok).toBe(false);
    expect(emailReadiness(loadConfig(scalewayConfig)).ok).toBe(true);
  });
});

describe('mail-test', () => {
  const config = loadConfig({ DATABASE_URL: 'postgres://x/y' });
  const fakeScaleway = (result: Awaited<ReturnType<ScalewayMailer['trySend']>>) => {
    const sent: string[] = [];
    const m: ScalewayMailer = {
      trySend: (msg) => {
        sent.push(msg.to);
        return Promise.resolve(result);
      },
      send: () => Promise.resolve(),
    };
    return { m, sent };
  };

  it('sends one message to the address given and says accepted is not delivered', async () => {
    const { m, sent } = fakeScaleway({ sent: true, id: 'x' });
    const lines: string[] = [];
    expect(await mailTest(config, m, 'me@example.org', (l) => lines.push(l))).toBe(0);
    expect(sent).toEqual(['me@example.org']);
    expect(lines.join('\n')).toMatch(/spam/);
  });

  it('sends nothing without a usable address', async () => {
    const { m, sent } = fakeScaleway({ sent: true });
    expect(await mailTest(config, m, undefined, () => undefined)).toBe(2);
    expect(await mailTest(config, m, 'nobody', () => undefined)).toBe(2);
    expect(sent).toEqual([]);
  });

  it('fails when the provider refuses, and when there is no provider at all', async () => {
    const { m } = fakeScaleway({ sent: false, reason: 'rejected', detail: 'no' });
    expect(await mailTest(config, m, 'me@example.org', () => undefined)).toBe(1);
    expect(await mailTest(config, capturingMailer(), 'me@example.org', () => undefined)).toBe(1);
  });
});
