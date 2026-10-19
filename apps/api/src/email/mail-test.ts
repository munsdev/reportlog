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
import type { EmailSender } from './types.ts';
import { isSendableAddress } from './types.ts';

export async function mailTest(
  config: Pick<
    Config,
    'EMAIL_TRANSPORT' | 'EMAIL_FROM_ADDRESS' | 'SCALEWAY_REGION' | 'SITE_ORIGIN'
  >,
  sender: EmailSender,
  to: string | undefined,
  say: (line: string) => void,
): Promise<number> {
  say(
    `transport  ${config.EMAIL_TRANSPORT}${config.EMAIL_TRANSPORT === 'scaleway' ? ` (${config.SCALEWAY_REGION})` : ''}`,
  );
  say(`from       ${config.EMAIL_FROM_ADDRESS ?? '(not set)'}`);

  if (!to || !isSendableAddress(to)) {
    say('Give an address you can read: reportlog mail-test you@example.org');
    say('The point is to see it ARRIVE, not only that the provider accepted it.');
    return 2;
  }
  const stamp = new Date().toISOString();
  const result = await sender.send({
    to,
    subject: `Mail test from ${config.SITE_ORIGIN ?? 'ReportLog'}`,
    text: [
      `This is a test message from the ReportLog site at ${config.SITE_ORIGIN ?? '(SITE_ORIGIN not set)'}.`,
      `It was sent at ${stamp}.`,
      '',
      'If it arrived, report confirmation links and sign-in codes will arrive too.',
    ].join('\n'),
  });

  if (result.sent) {
    say(`Accepted for delivery${result.id ? ` (id ${result.id})` : ''}.`);
    say('Accepted is not delivered: check the inbox, and the spam folder. A sending');
    say('domain without SPF, DKIM and DMARC records is usually filed as junk.');
    return 0;
  }
  say(`Not sent (${result.reason}): ${result.detail}`);
  if (result.reason === 'rejected') {
    say('Usual causes: the sending domain is not verified in Scaleway yet, the FROM');
    say('address is not on that domain, or the key lacks Transactional Email rights.');
  }
  return 1;
}
