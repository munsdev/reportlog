/**
 * The feedback tracker's three emails, as plain text (the Mailer sends
 * nothing else). Pure string building: no database, no sending.
 *
 * Every link goes to a page, never to an address carrying a token.
 */
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS } from '@reportlog/contracts';
import type { FeedbackContext } from '@reportlog/contracts';

export interface EmailText {
  subject: string;
  text: string;
}

// Looked up as plain strings: a row holds what the table's CHECK allows,
// and a word nobody wrote a label for is shown as it is.
const label = (labels: Record<string, string>, k: string) => labels[k] ?? k;
const typeWord = (t: string) => label(FEEDBACK_TYPE_LABELS, t);
const statusWord = (s: string) => label(FEEDBACK_STATUS_LABELS, s);

function contextLines(c: FeedbackContext): string[] {
  return [
    c.page ? `Screen: ${c.page}` : null,
    c.viewport ? `Window: ${c.viewport}` : null,
    c.browser ? `Browser: ${c.browser}` : null,
  ].filter((l): l is string => l !== null);
}

/**
 * To the administrator, for every new issue. Without an outside tracker
 * nothing else says that something was filed: this is what stands between
 * an issue and it being forgotten.
 */
export function newFeedbackEmail(
  fb: {
    id: number;
    type: string;
    severity: string;
    title: string;
    body: string;
    related_ref: string | null;
    context: FeedbackContext;
    submitter_email: string;
  },
  siteOrigin: string,
): EmailText {
  const context = contextLines(fb.context);
  return {
    subject: `Feedback #${String(fb.id)} (${fb.severity}): ${fb.title}`,
    text: [
      `${fb.submitter_email} filed feedback #${String(fb.id)}: ${typeWord(fb.type).toLowerCase()}, ${fb.severity}.`,
      '',
      fb.title,
      '',
      fb.body,
      ...(fb.related_ref ? ['', `About report ${fb.related_ref}.`] : []),
      ...(context.length ? ['', ...context] : []),
      '',
      `Read it and reply: ${siteOrigin}/settings/feedback`,
    ].join('\n'),
  };
}

/** To the tester, when their issue moves. The note was written for them. */
export function statusEmail(
  fb: { id: number; type: string; title: string; status: string; note: string },
  siteOrigin: string,
): EmailText {
  return {
    subject: `Your feedback #${String(fb.id)} is now: ${statusWord(fb.status)}`,
    text: [
      `Your feedback #${String(fb.id)}, "${fb.title}", is now: ${statusWord(fb.status)}.`,
      '',
      fb.note,
      '',
      `See the whole history: ${siteOrigin}/feedback`,
    ].join('\n'),
  };
}

export interface OpenIssue {
  id: number;
  type: string;
  severity: string;
  title: string;
  status: string;
  submitter_email: string;
  days_untouched: number;
}

/**
 * Weekly, to the administrator: every open issue, the longest-untouched
 * first, and loud about anything that has sat past `staleDays`. The point is
 * that nothing quietly rots at the bottom of a list.
 */
export function staleDigestEmail(
  items: readonly OpenIssue[],
  staleDays: number,
  siteOrigin: string,
): EmailText {
  const stale = items.filter((i) => i.days_untouched >= staleDays).length;
  const days = (n: number) => (n === 1 ? '1 day' : `${String(n)} days`);
  const rows = items.map((i) =>
    [
      `${i.days_untouched >= staleDays ? 'STALE  ' : ''}#${String(i.id)} ${i.title}`,
      `  ${statusWord(i.status)}, ${i.severity}, ${typeWord(i.type).toLowerCase()}, from ${i.submitter_email}`,
      `  Not moved for ${days(i.days_untouched)}.`,
    ].join('\n'),
  );
  return {
    subject: `Feedback: ${String(items.length)} open${stale ? `, ${String(stale)} stale` : ''}`,
    text: [
      `${items.length === 1 ? 'One issue is' : `${String(items.length)} issues are`} still open, the longest-untouched first. ` +
        `"Stale" means nobody has changed its status for ${days(staleDays)} or more.`,
      '',
      rows.join('\n\n'),
      '',
      `Work through them: ${siteOrigin}/settings/feedback`,
    ].join('\n'),
  };
}
