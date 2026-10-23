/**
 * Sending through any SMTP server (Proton Mail's SMTP submission, a mail
 * host's relay, your own), behind the same `Mailer` interface and the same
 * rules as scaleway.ts. Ported from the old application's `src/email.js`:
 * the same settings, one pooled connection, timeouts, and no address in any
 * log line.
 *
 * Either SMTP or Scaleway, never both: EMAIL_TRANSPORT names one. There is no
 * fallback from one to the other on purpose, so which provider sent a
 * message is never a guess.
 *
 * THE RULES, as in scaleway.ts:
 *
 * - One recipient per message, plain text only.
 * - The recipient's address and the body are never logged or put in an
 *   error. An SMTP server's refusal often QUOTES the address ("<x@y>:
 *   Recipient address rejected"), so every address-shaped string is taken
 *   out of what the server said before it is kept.
 * - A refusal is an outcome: `trySend` returns it, `send` throws
 *   `MailNotSent` so a route never tells a reporter to check an inbox
 *   nothing reached.
 */
import nodemailer from 'nodemailer';
import type { EmailMessage } from './mailer.ts';
import type { ProviderMailer, SendFailure, SendResult } from './scaleway.ts';
import { MailNotSent, isSendableAddress } from './scaleway.ts';

export interface SmtpOptions {
  host: string;
  port: number;
  /** Direct TLS (port 465). Unset: decided by the port, STARTTLS otherwise. */
  secure?: boolean | undefined;
  /** Unset: the server takes mail without signing in (a local relay). */
  user?: string | undefined;
  pass?: string | undefined;
  from: { email: string; name?: string };
  /** For tests: something to hand the message to instead of a real connection. */
  transport?: SmtpTransport;
}

/** The one thing used of nodemailer's transport. */
export interface SmtpTransport {
  sendMail(message: {
    from: string | { name: string; address: string };
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
}

/** Anything that looks like an address, out of a server's words. */
const ADDRESSES = /[^\s<>()"',;:]+@[^\s<>()"',;:]+/g;
export const scrubbed = (s: string) =>
  s.replace(ADDRESSES, '[address]').replace(/\s+/g, ' ').slice(0, 300);

interface SmtpError {
  code?: string;
  responseCode?: number;
  response?: string;
  message?: string;
}

/**
 * What the failure means. A 5xx reply or a refused login will not change
 * if the message is sent again; a 4xx reply, a timeout or a lost connection
 * may.
 */
export function classify(err: unknown): { reason: SendFailure; detail: string } {
  const e = (typeof err === 'object' && err !== null ? err : {}) as SmtpError;
  const said = scrubbed(e.response ?? e.message ?? 'no answer');
  if (e.code === 'EAUTH') {
    return {
      reason: 'rejected',
      detail: `The mail server refused the sign-in (SMTP_USER or SMTP_PASS): ${said}`,
    };
  }
  if (typeof e.responseCode === 'number') {
    const code = String(e.responseCode);
    return e.responseCode >= 500
      ? { reason: 'rejected', detail: `The mail server refused the message (${code}): ${said}` }
      : { reason: 'unreachable', detail: `The mail server answered ${code}: ${said}` };
  }
  return {
    reason: 'unreachable',
    detail: `The mail server could not be reached (${e.code ?? 'error'}): ${said}`,
  };
}

function assertWellFormed(message: EmailMessage): void {
  if (!message.subject.trim()) throw new Error('An email needs a subject.');
  if (/[\r\n]/.test(message.subject)) throw new Error('An email subject is one line.');
  if (!message.text.trim()) throw new Error('An email needs a body.');
}

export function smtpMailer(options: SmtpOptions): ProviderMailer {
  // One connection pool for the life of the process, opened on first send.
  const transport: SmtpTransport =
    options.transport ??
    nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? options.port === 465,
      ...(options.user ? { auth: { user: options.user, pass: options.pass ?? '' } } : {}),
      pool: true,
      // A slow or wedged mail server must not hold a request open: every
      // caller is inside an HTTP handler somebody is waiting on.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  const from = options.from.name
    ? { name: options.from.name, address: options.from.email }
    : options.from.email;

  async function trySend(message: EmailMessage): Promise<SendResult> {
    assertWellFormed(message);
    if (!isSendableAddress(message.to)) {
      return {
        sent: false,
        reason: 'invalid',
        detail: 'the recipient address is not one a provider would accept.',
      };
    }
    try {
      const info: unknown = await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      const id = (info as { messageId?: unknown } | null)?.messageId;
      return { sent: true, ...(typeof id === 'string' && id ? { id } : {}) };
    } catch (err) {
      return { sent: false, ...classify(err) };
    }
  }

  return {
    trySend,
    async send(message) {
      const result = await trySend(message);
      if (!result.sent) throw new MailNotSent(result.reason, result.detail);
    },
  };
}
