/**
 * Sending through Scaleway Transactional Email (Paris).
 *
 * One HTTPS request per message to the regional API. No SMTP connection to
 * keep alive and no client library: the request is small enough to read.
 *
 * WHAT IS NEVER LOGGED: the recipient's address and the body. A body carries
 * one-time codes and confirmation links; a log line pairing an address with
 * a failure is the start of a contact list.
 */
import type { EmailMessage, EmailSender, SendResult } from './types.ts';
import { assertWellFormed, isSendableAddress } from './types.ts';

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

export function createScalewaySender(options: ScalewayOptions): EmailSender {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fail = (reason: 'invalid' | 'rejected' | 'unreachable', detail: string): SendResult => ({
    sent: false,
    transport: 'scaleway',
    reason,
    detail,
  });

  return {
    transport: 'scaleway',
    async send(message: EmailMessage): Promise<SendResult> {
      assertWellFormed(message);
      if (!isSendableAddress(message.to)) {
        return fail('invalid', 'The recipient address is not one a provider would accept.');
      }
      const body = {
        from: {
          email: options.from.email,
          ...(options.from.name ? { name: options.from.name } : {}),
        },
        to: [{ email: message.to }],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
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
        return { sent: true, transport: 'scaleway', ...(id ? { id } : {}) };
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
