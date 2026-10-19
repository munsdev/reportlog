/**
 * Sending through Scaleway Transactional Email (Paris), behind workstream A's
 * `Mailer` interface (mailer.ts).
 *
 * One HTTPS request per message to the regional API. No SMTP connection to
 * keep alive and no client library: the request is small enough to read.
 *
 * THE RULES, whichever interface carries them:
 *
 * - One recipient per message. Everything this site sends is addressed to
 *   one person, and a message with several recipients is how one person's
 *   address ends up in another person's inbox.
 * - The recipient's address and the body are never logged or put in an
 *   error. A body carries one-time codes and links; a failure paired with an
 *   address is the start of a contact list.
 * - A provider that refuses or cannot be reached is an outcome, not a crash.
 *   `trySend` returns it as a result. `send`, which is the `Mailer` contract
 *   every route calls, throws `MailNotSent` carrying that result, because a
 *   route that went on as if the mail had gone would tell a reporter to
 *   check an inbox nothing reached. Routes that can carry on (lists) catch
 *   it; the others let the error handler say the message could not be sent.
 */
import type { EmailMessage, Mailer } from './mailer.ts';

export type SendFailure = 'invalid' | 'rejected' | 'unreachable';

export type SendResult =
  | { sent: true; id?: string }
  | {
      sent: false;
      /**
       * invalid: the address is not one a provider would accept.
       * rejected: the provider refused this message; sending it again will not help.
       * unreachable: the provider could not be reached or failed; it may work later.
       */
      reason: SendFailure;
      /** A sentence for the log. Never contains the recipient's address. */
      detail: string;
    };

/** Thrown by `send`. Its message is the provider's answer, never the address or body. */
export class MailNotSent extends Error {
  readonly reason: SendFailure;
  constructor(reason: SendFailure, detail: string) {
    super(`The email was not sent: ${detail}`);
    this.name = 'MailNotSent';
    this.reason = reason;
  }
}

export interface ScalewayMailer extends Mailer {
  trySend(message: EmailMessage): Promise<SendResult>;
}

export interface ScalewayOptions {
  secretKey: string;
  projectId: string;
  region: string;
  from: { email: string; name?: string };
  /** Injected by tests. */
  fetch?: typeof fetch;
  /** A wedged provider must not hold a request somebody is waiting on. */
  timeoutMs?: number;
}

export function apiUrl(region: string): string {
  return `https://api.scaleway.com/transactional-email/v1alpha1/regions/${region}/emails`;
}

/** Deliberately loose: the provider is the authority, this only stops obvious junk. */
const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export function isSendableAddress(address: string): boolean {
  return address.length <= 254 && ADDRESS.test(address);
}

/** Programming errors, which throw whatever the transport. */
function assertWellFormed(message: EmailMessage): void {
  if (!message.subject.trim()) throw new Error('An email needs a subject.');
  if (/[\r\n]/.test(message.subject)) throw new Error('An email subject is one line.');
  if (!message.text.trim()) throw new Error('An email needs a body.');
}

export function scalewayMailer(options: ScalewayOptions): ScalewayMailer {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fail = (reason: SendFailure, detail: string): SendResult => ({
    sent: false,
    reason,
    detail,
  });

  async function trySend(message: EmailMessage): Promise<SendResult> {
    assertWellFormed(message);
    if (!isSendableAddress(message.to)) {
      return fail('invalid', 'the recipient address is not one a provider would accept.');
    }
    // Plain text only, as the Mailer interface says: a message is a code or
    // a link and a sentence or two, and plain text cannot carry somebody's
    // input as markup.
    const body = {
      from: {
        email: options.from.email,
        ...(options.from.name ? { name: options.from.name } : {}),
      },
      to: [{ email: message.to }],
      subject: message.subject,
      text: message.text,
      project_id: options.projectId,
    };

    let res: Response;
    try {
      res = await doFetch(apiUrl(options.region), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth-token': options.secretKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const why = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'failed';
      return fail('unreachable', `Scaleway could not be reached: the request ${why}.`);
    }

    if (res.ok) {
      const id = await res
        .json()
        .then((j: unknown) => emailId(j))
        .catch(() => undefined);
      return { sent: true, ...(id ? { id } : {}) };
    }
    // Scaleway's error body names the problem ("domain not verified",
    // "quota exceeded") and does not echo the recipient, so it is kept,
    // shortened, for the person reading the log.
    const said = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    const status = String(res.status);
    // 429 and 5xx may pass; any other 4xx is about this message or this
    // account, and resending will not change the answer.
    if (res.status === 429 || res.status >= 500) {
      return fail('unreachable', `Scaleway answered ${status}: ${said}`);
    }
    return fail('rejected', `Scaleway refused the message (${status}): ${said}`);
  }

  return {
    trySend,
    async send(message) {
      const result = await trySend(message);
      if (!result.sent) throw new MailNotSent(result.reason, result.detail);
    },
  };
}

function emailId(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null || !('emails' in json)) return undefined;
  const emails: unknown = json.emails;
  if (!Array.isArray(emails)) return undefined;
  const first: unknown = emails[0];
  if (typeof first !== 'object' || first === null || !('id' in first)) return undefined;
  return typeof first.id === 'string' ? first.id : undefined;
}
