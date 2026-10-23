/**
 * Which `Mailer` (mailer.ts, workstream A's interface) this process uses.
 *
 *   MAIL_OUTBOX set             outboxMailer: files a browser test reads
 *   EMAIL_TRANSPORT=scaleway    scalewayMailer: Scaleway Transactional Email
 *   EMAIL_TRANSPORT=smtp        smtpMailer: any SMTP server (Proton Mail, say)
 *   EMAIL_TRANSPORT=off         stderrMailer: standard error, so a fresh
 *                               install can still sign its operator in
 *
 * `off` is the default so a checkout never sends real mail by accident. The
 * doctor fails a server left on it, or with MAIL_OUTBOX set.
 */
import type { Config } from '../config.ts';
import type { Mailer } from './mailer.ts';
import { outboxMailer, stderrMailer } from './mailer.ts';
import type { ProviderMailer } from './scaleway.ts';
import { scalewayMailer } from './scaleway.ts';
import { smtpMailer } from './smtp.ts';

type EmailConfig = Pick<
  Config,
  | 'EMAIL_TRANSPORT'
  | 'EMAIL_FROM_ADDRESS'
  | 'EMAIL_FROM_NAME'
  | 'MAIL_OUTBOX'
  | 'SCALEWAY_SECRET_KEY'
  | 'SCALEWAY_PROJECT_ID'
  | 'SCALEWAY_REGION'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_USER'
  | 'SMTP_PASS'
  | 'SMTP_SECURE'
>;

export function createMailer(
  config: EmailConfig,
  fetchImpl?: typeof fetch,
): Mailer | ProviderMailer {
  if (config.MAIL_OUTBOX) return outboxMailer(config.MAIL_OUTBOX);
  if (config.EMAIL_TRANSPORT === 'off') return stderrMailer();
  const from = (email: string) => ({
    email,
    ...(config.EMAIL_FROM_NAME ? { name: config.EMAIL_FROM_NAME } : {}),
  });
  if (config.EMAIL_TRANSPORT === 'smtp') {
    // loadConfig refuses smtp without these; checked again for the same reason.
    if (!config.SMTP_HOST || !config.EMAIL_FROM_ADDRESS) {
      throw new Error('EMAIL_TRANSPORT=smtp needs SMTP_HOST and EMAIL_FROM_ADDRESS.');
    }
    return smtpMailer({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE === undefined ? undefined : config.SMTP_SECURE === 'true',
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
      from: from(config.EMAIL_FROM_ADDRESS),
    });
  }
  // loadConfig refuses a scaleway transport without these; checked again so
  // a hand-built config cannot reach the provider half-filled.
  const { SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID, EMAIL_FROM_ADDRESS } = config;
  if (!SCALEWAY_SECRET_KEY || !SCALEWAY_PROJECT_ID || !EMAIL_FROM_ADDRESS) {
    throw new Error(
      'EMAIL_TRANSPORT=scaleway needs SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID and EMAIL_FROM_ADDRESS.',
    );
  }
  return scalewayMailer({
    secretKey: SCALEWAY_SECRET_KEY,
    projectId: SCALEWAY_PROJECT_ID,
    region: config.SCALEWAY_REGION,
    from: from(EMAIL_FROM_ADDRESS),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

/** What a configuration lacks to deliver mail on a server, without sending any. For the doctor. */
export function emailReadiness(config: EmailConfig): { ok: boolean; problem?: string } {
  if (config.MAIL_OUTBOX) {
    return {
      ok: false,
      problem: `MAIL_OUTBOX is set: mail is written to ${config.MAIL_OUTBOX} for tests and never delivered.`,
    };
  }
  if (config.EMAIL_TRANSPORT === 'off') {
    return {
      ok: false,
      problem:
        'EMAIL_TRANSPORT is off: mail goes to the service log, so no reporter can confirm a report. Set it to scaleway or smtp.',
    };
  }
  return { ok: true };
}
