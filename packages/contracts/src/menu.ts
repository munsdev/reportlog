/**
 * The site menu's one call: how much work is waiting for the person asking
 * (docs/design/navigation.md, sections 01 and 07).
 *
 * Totals only, never a report, an entry or a link. Each number is present
 * ONLY for somebody the screen it counts would admit, by the same rule that
 * screen's own route uses, so the menu never tells anybody more than the
 * screen would. A missing key means "not yours to know", not zero.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Count = z.number().int().nonnegative();

export const MenuWaiting = z.object({
  /** Reports waiting for a moderator: the queue's own default view (pending, not withdrawn). */
  reports: Count.optional(),
  /** List entries nobody has reviewed yet, across every list. */
  list_entries: Count.optional(),
  /** Tip links nobody has checked yet. */
  tip_links: Count.optional(),
  /** Feedback issues still open (new, investigating, in progress, waiting on the tester). */
  feedback: Count.optional(),
});
export type MenuWaiting = z.infer<typeof MenuWaiting>;

export const getMenuWaiting = defineRoute({
  method: 'GET',
  path: '/api/menu/waiting',
  summary:
    'How much work is waiting for the person signed in, for the screens they may open. Totals only.',
  response: MenuWaiting,
});
