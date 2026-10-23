/**
 * The SMTP sender (src/email/smtp.ts): the old application's module, behind
 * the new rules. A fake transport stands in for the server, so nothing is
 * sent and no network is touched.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { createMailer } from '../../src/email/index.ts';
import { MailNotSent } from '../../src/email/scaleway.ts';
import { classify, smtpMailer } from '../../src/email/smtp.ts';

const MESSAGE = { to: 'reporter@example.org', subject: 'Confirm your report', text: 'A link.' };
const FROM = { email: 'reports@example.org', name: 'Example Reports' };

const fake = (outcome: { info?: unknown; error?: Error }) => {
  const sent: unknown[] = [];
  return {
    sent,
    transport: {
      sendMail: (m: unknown) => {
        sent.push(m);
        return outcome.error ? Promise.reject(outcome.error) : Promise.resolve(outcome.info ?? {});
      },
    },
  };
};

describe('sending through SMTP', () => {
  it('sends one plain-text message to one person, from the configured sender', async () => {
    const f = fake({ info: { messageId: '<abc@example.org>' } });
    const m = smtpMailer({ host: 'h', port: 587, from: FROM, transport: f.transport });
    expect(await m.trySend(MESSAGE)).toEqual({ sent: true, id: '<abc@example.org>' });
    expect(f.sent).toEqual([
      {
        from: { name: 'Example Reports', address: 'reports@example.org' },
        to: 'reporter@example.org',
        subject: 'Confirm your report',
        text: 'A link.',
      },
    ]);
  });

  it('a refusal is an outcome, and never carries the address the server quoted', async () => {
    const error = Object.assign(new Error('x'), {
      responseCode: 550,
      response: '550 5.1.1 <reporter@example.org>: Recipient address rejected',
    });
    const m = smtpMailer({
      host: 'h',
      port: 587,
      from: FROM,
      transport: fake({ error }).transport,
    });
    const r = await m.trySend(MESSAGE);
    expect(r).toMatchObject({ sent: false, reason: 'rejected' });
    expect(JSON.stringify(r)).not.toContain('reporter@example.org');
    await expect(m.send(MESSAGE)).rejects.toBeInstanceOf(MailNotSent);
  });

  it('tells a wrong password, a refusal and a server that may answer later apart', () => {
    expect(classify({ code: 'EAUTH', response: '535 bad credentials' }).reason).toBe('rejected');
    expect(classify({ responseCode: 554, response: 'no' }).reason).toBe('rejected');
    expect(classify({ responseCode: 421, response: 'try later' }).reason).toBe('unreachable');
    expect(classify({ code: 'ETIMEDOUT', message: 'Connection timeout' }).reason).toBe(
      'unreachable',
    );
  });

  it('refuses an address no provider would take, without asking the server', async () => {
    const f = fake({});
    const m = smtpMailer({ host: 'h', port: 587, from: FROM, transport: f.transport });
    expect(await m.trySend({ ...MESSAGE, to: 'not an address' })).toMatchObject({
      sent: false,
      reason: 'invalid',
    });
    expect(f.sent).toEqual([]);
  });
});

describe('choosing SMTP', () => {
  const base = { DATABASE_URL: 'postgres://x@localhost/x', EMAIL_TRANSPORT: 'smtp' };

  it('is refused at start without a server and a sender, or a password for a user', () => {
    expect(() => loadConfig(base)).toThrow(/SMTP_HOST/);
    expect(() =>
      loadConfig({
        ...base,
        SMTP_HOST: 'smtp.protonmail.ch',
        EMAIL_FROM_ADDRESS: 'reports@example.org',
        SMTP_USER: 'reports@example.org',
      }),
    ).toThrow(/SMTP_PASS/);
  });

  it('is one provider: a configured SMTP server is what sends', () => {
    const c = loadConfig({
      ...base,
      SMTP_HOST: 'smtp.protonmail.ch',
      EMAIL_FROM_ADDRESS: 'reports@example.org',
      SMTP_USER: 'reports@example.org',
      SMTP_PASS: 'a-token-of-some-length',
      // Scaleway's key present too: still SMTP, because EMAIL_TRANSPORT says so.
      SCALEWAY_SECRET_KEY: '00000000-0000-0000-0000-000000000000',
    });
    expect(c.SMTP_PORT).toBe(587);
    expect('trySend' in createMailer(c)).toBe(true);
  });
});
