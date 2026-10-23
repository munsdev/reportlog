/**
 * `reportlog mail-test you@example.org`: send one real message, to prove
 * mail works before it has to.
 *
 * Mail is what an install most often gets wrong and discovers last. Without
 * it nobody can confirm a report and nobody can sign in, including the
 * person who just installed it, and that does not look like "mail is
 * broken". So: one command, one message, a plain answer.
 */
import type { Config } from '../config.ts';
import type { Mailer } from './mailer.ts';
import type { ProviderMailer, SendResult } from './scaleway.ts';
import { isSendableAddress } from './scaleway.ts';

export async function mailTest(
  config: Pick<
    Config,
    | 'EMAIL_TRANSPORT'
    | 'EMAIL_FROM_ADDRESS'
    | 'SCALEWAY_REGION'
    | 'SITE_ORIGIN'
    | 'MAIL_OUTBOX'
    | 'SMTP_HOST'
    | 'SMTP_PORT'
  >,
  mailer: Mailer | ProviderMailer,
  to: string | undefined,
  say: (line: string) => void,
): Promise<number> {
  const transport = config.MAIL_OUTBOX
    ? `outbox (${config.MAIL_OUTBOX})`
    : config.EMAIL_TRANSPORT === 'scaleway'
      ? `scaleway (${config.SCALEWAY_REGION})`
      : config.EMAIL_TRANSPORT === 'smtp'
        ? `smtp (${config.SMTP_HOST ?? '?'}:${String(config.SMTP_PORT)})`
        : 'off (standard error)';
  say(`transport  ${transport}`);
  say(`from       ${config.EMAIL_FROM_ADDRESS ?? '(not set)'}`);

  if (!to || !isSendableAddress(to)) {
    say('Give an address you can read: reportlog mail-test you@example.org');
    say('The point is to see it ARRIVE, not only that the provider accepted it.');
    return 2;
  }
  const message = {
    to,
    subject: `Mail test from ${config.SITE_ORIGIN}`,
    text: [
      `This is a test message from the ReportLog site at ${config.SITE_ORIGIN}.`,
      `It was sent at ${new Date().toISOString()}.`,
      '',
      'If it arrived, report confirmation links and sign-in codes will arrive too.',
    ].join('\n'),
  };
  let result: SendResult;
  if ('trySend' in mailer) {
    result = await mailer.trySend(message);
  } else {
    await mailer.send(message);
    say('Nothing was sent to a provider: this deployment has no mail transport.');
    return 1;
  }

  if (result.sent) {
    say(`Accepted for delivery${result.id ? ` (id ${result.id})` : ''}.`);
    say('Accepted is not delivered: check the inbox, and the spam folder. A sending');
    say('domain without SPF, DKIM and DMARC records is usually filed as junk.');
    return 0;
  }
  say(`Not sent (${result.reason}): ${result.detail}`);
  if (result.reason === 'rejected' && config.EMAIL_TRANSPORT === 'smtp') {
    say('Usual causes: a wrong SMTP_USER or SMTP_PASS (for Proton, the SMTP token, not');
    say('the account password), or a FROM address the server will not send as.');
  } else if (result.reason === 'rejected') {
    say('Usual causes: the sending domain is not verified in Scaleway yet, the FROM');
    say('address is not on that domain, or the key lacks Transactional Email rights.');
  }
  return 1;
}
