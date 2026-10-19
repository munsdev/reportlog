/**
 * Email: one sender per process, chosen by EMAIL_TRANSPORT.
 *
 *   const email = createEmailSender(config, (line) => app.log.warn(line));
 *   const result = await email.send({ to, subject, text });
 *   if (!result.sent) ...decide: tell the person, retry later, or log.
 *
 * `off` is the default so a fresh checkout never sends real mail by accident.
 * It sends nothing, says so in the log (subject only), and answers
 * `not-configured`, which is how a caller tells "this deployment cannot
 * send" from "this message failed". The doctor fails a server left on `off`.
 */
import type { Config } from '../config.ts';
import { createCaptureSender } from './capture.ts';
import { createScalewaySender } from './scaleway.ts';
import type { EmailMessage, EmailSender, SendResult } from './types.ts';
import { assertWellFormed } from './types.ts';

export type { CaptureSender, CapturedEmail } from './capture.ts';
export { createCaptureSender, linkIn, readCaptured } from './capture.ts';
export { createScalewaySender } from './scaleway.ts';
export type { EmailMessage, EmailSender, EmailTransport, SendResult } from './types.ts';
export { isSendableAddress } from './types.ts';

type EmailConfig = Pick<
  Config,
  | 'EMAIL_TRANSPORT'
  | 'EMAIL_FROM_ADDRESS'
  | 'EMAIL_FROM_NAME'
  | 'EMAIL_CAPTURE_DIR'
  | 'SCALEWAY_SECRET_KEY'
  | 'SCALEWAY_PROJECT_ID'
  | 'SCALEWAY_REGION'
>;

export function createEmailSender(
  config: EmailConfig,
  log: (line: string) => void = () => undefined,
  fetchImpl?: typeof fetch,
): EmailSender {
  switch (config.EMAIL_TRANSPORT) {
    case 'scaleway': {
      // loadConfig refuses a scaleway transport without these; checked again
      // so a hand-built config cannot reach the provider half-filled.
      const { SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID, EMAIL_FROM_ADDRESS } = config;
      if (!SCALEWAY_SECRET_KEY || !SCALEWAY_PROJECT_ID || !EMAIL_FROM_ADDRESS) {
        throw new Error(
          'EMAIL_TRANSPORT=scaleway needs SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID and EMAIL_FROM_ADDRESS.',
        );
      }
      return createScalewaySender({
        secretKey: SCALEWAY_SECRET_KEY,
        projectId: SCALEWAY_PROJECT_ID,
        region: config.SCALEWAY_REGION,
        from: {
          email: EMAIL_FROM_ADDRESS,
          ...(config.EMAIL_FROM_NAME ? { name: config.EMAIL_FROM_NAME } : {}),
        },
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      });
    }
    case 'capture':
      return createCaptureSender(config.EMAIL_CAPTURE_DIR ? { dir: config.EMAIL_CAPTURE_DIR } : {});
    case 'off':
      return offSender(log);
  }
}

function offSender(log: (line: string) => void): EmailSender {
  return {
    transport: 'off',
    send(message: EmailMessage): Promise<SendResult> {
      assertWellFormed(message);
      // The subject only. Not the address, and never the body: it carries
      // one-time codes and confirmation links, and a log is the wrong place
      // for either.
      log(`email is off (EMAIL_TRANSPORT=off): not sending "${message.subject}"`);
      return Promise.resolve({
        sent: false,
        transport: 'off',
        reason: 'not-configured',
        detail: 'This deployment has no mail transport (EMAIL_TRANSPORT=off).',
      });
    },
  };
}

/** What a configuration is missing to send mail, without sending any. For the doctor. */
export function emailReadiness(config: EmailConfig): { ok: boolean; problem?: string } {
  if (config.EMAIL_TRANSPORT === 'off') {
    return {
      ok: false,
      problem:
        'EMAIL_TRANSPORT is off: no report can be confirmed and nobody can sign in. Set it to scaleway.',
    };
  }
  if (config.EMAIL_TRANSPORT === 'capture') {
    return {
      ok: false,
      problem: 'EMAIL_TRANSPORT is capture: mail is kept for tests and never delivered.',
    };
  }
  return { ok: true };
}
