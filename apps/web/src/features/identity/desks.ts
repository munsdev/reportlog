/**
 * Where each desk suggests somebody starts. DISPLAY ONLY: a desk hides
 * nothing and opens nothing, and a start that the person cannot open (a
 * moderating desk on somebody who is not a moderator) is simply not offered.
 * Every start is a staff screen in the menu's own list, so the two cannot
 * disagree about where a screen is or who may open it.
 */
import { DESKS } from '@reportlog/contracts';
import type { DeskId } from '@reportlog/contracts';
import { STAFF_ENTRIES, mayOpen } from '../staff-nav/entries.ts';
import type { StaffEntry, Viewer } from '../staff-nav/entries.ts';

export const STARTS_AT: Readonly<Record<DeskId, StaffEntry['to']>> = {
  lead_dev: '/feedback',
  dev: '/feedback',
  accessibility: '/feedback',
  testing: '/feedback',
  moderating: '/moderate',
  policy: '/moderate',
  group: '/access/orgs',
  translation: '/settings/words',
  design: '/settings/look',
  outreach: '/docs',
};

const labelOf = new Map<string, string>(DESKS.map((d) => [d.id, d.label]));

export function deskLabel(id: string): string | undefined {
  return labelOf.get(id);
}

/** This person's desks, each with where to start if they may open it. Unknown ids are left out. */
export function desksFor(desks: readonly string[], viewer: Viewer) {
  return desks.flatMap((id) => {
    const label = labelOf.get(id);
    if (!label) return [];
    const to = STARTS_AT[id as DeskId];
    const entry = STAFF_ENTRIES.find((e) => e.to === to && !e.alias);
    return [{ id, label, start: entry && mayOpen(entry, viewer) ? entry : null }];
  });
}
