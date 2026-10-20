/**
 * What the lists screens call things. One place, so the staff screens and the
 * visitor's form never describe the same setting two ways.
 */
import type {
  LinkFilter,
  ListEmailMode,
  ListOutsideAccess,
  ListVisibility,
  Retention,
  ReviewState,
  TriageState,
} from '@reportlog/contracts';

export const VISIBILITY: Record<ListVisibility, { label: string; help: string }> = {
  hidden: {
    label: 'Hidden',
    help: 'Only administrators can open it, to see what the form looks like.',
  },
  password: { label: 'Team only', help: 'Anybody signed in can open it.' },
  listed: {
    label: 'Listed',
    help: 'Anybody who can reach the site, and it is on the front page while it takes entries.',
  },
};

export const OUTSIDE: Record<ListOutsideAccess, { label: string; help: string }> = {
  closed: { label: 'Behind the site password', help: 'Like everything else on the site.' },
  link: {
    label: 'Anybody with the link',
    help: 'Works without the site password, but is not offered anywhere.',
  },
  door: {
    label: 'Offered on the password page',
    help: 'Works without the site password, and the password page links to it.',
  },
};

export const EMAIL_MODE: Record<ListEmailMode, { label: string; help: string }> = {
  auto: {
    label: 'Only from somebody who writes something',
    help: 'So they can have what they wrote deleted. Somebody who only picks answers is not asked.',
  },
  required: {
    label: 'From everybody',
    help: 'For a form people use to reach whoever runs the site, so you can reply.',
  },
};

export const RETENTION: Record<Retention, { label: string; help: string }> = {
  transient: {
    label: 'Deleted on the timer',
    help: 'Erased after the retention period, or sooner if the person asks.',
  },
  durable: { label: 'Kept', help: 'Never erased. Right for links, choices and counts.' },
  absent: { label: 'Not asked', help: 'Kept on the form but not shown or collected.' },
};

export const REVIEW: Record<ReviewState, string> = {
  received: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const TRIAGE: Record<TriageState, string> = {
  new: 'New',
  triaged: 'Looked at',
  actioned: 'Acted on',
  closed: 'Closed',
};

/** How long the personal half is kept, in words. */
export function keptFor(days: number | null): string {
  return days === null ? 'until the person asks' : `${String(days)} days`;
}

/** An answer, as text. */
export function said(v: string | number | boolean | string[]): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return String(v);
}

/** How a link was checked (Plan D M3), in the words a moderator reads. */
export const LINK_OUTCOME: Record<LinkFilter, string> = {
  unchecked: 'Not checked yet',
  checked: 'Checked: journalists may see it',
  withheld: 'Withheld from journalists',
  illegal: 'Illegal: erased',
};
