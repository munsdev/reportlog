/**
 * The shape of a menu line, apart from entries.ts so that the menu (menu.ts)
 * and the helpers in entries.ts can both use it without importing each other.
 */
import type { SystemRole } from '@reportlog/access';
import type { MenuWaiting } from '@reportlog/contracts';
import type { LinkProps } from '@tanstack/react-router';

/**
 * `anyone` is every signed-in person; `role` is anyone who holds a role,
 * proved a second factor yet or not (the account-and-security page is how
 * they prove it).
 */
export type Audience =
  SystemRole | 'tester' | 'team' | 'organization' | 'org_manager' | 'anyone' | 'role';

export interface StaffEntry {
  to: NonNullable<LinkProps['to']>;
  label: string;
  for: readonly Audience[];
  /** A shorter name for the area tabs, where the area already says the rest. */
  tab?: string;
  /**
   * Addresses under these prefixes are this page too (a report's own page is
   * the queue's), so the menu and the tabs say "you are here" on them. The
   * longest matching prefix wins, so `/lists/review/` beats `/lists/`.
   */
  under?: readonly string[];
  /** Where on the page it opens, when that is not the top. */
  hash?: string;
  /**
   * A second way to a page another entry owns (the access log, inside
   * Moderation settings until it gets a route of its own). Never marked as
   * where you are, so one page is never "here" twice.
   */
  alias?: boolean;
  /** Which of the menu's waiting totals belongs beside it. */
  waiting?: keyof MenuWaiting;
}
