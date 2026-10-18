/**
 * Desks — what somebody on the team actually does.
 *
 * DISPLAY ONLY. A desk decides which portal tab opens first and what is
 * highlighted on the start page. It never hides a tab, it grants nothing,
 * and no route consults it. Somebody may hold several, or none.
 *
 * DECLARED HERE NOW. They used to be derived from the volunteer form's
 * role list in src/volunteer.js, so the two could not drift. That form is a
 * list since migration 047 and its roles are words an administrator edits,
 * so the desks — which ARE ids, stored against people — moved here, where
 * the thing that depends on them lives. Same ids as before, so nobody's
 * stored desk changes meaning.
 */

/** The staff portal's tabs, in the order they appear. */
export const PORTAL_TABS = [
  { id: 'start', label: 'Start here' },
  { id: 'voice', label: 'Voice and style' },
  { id: 'comms', label: 'Comms and social' },
  { id: 'orgs', label: 'Coordinators and organizations' },
  { id: 'dev', label: 'Developers and operators' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'safety', label: 'Safety and discretion' },
  { id: 'releases', label: 'Release notes' },
];

export const PORTAL_TAB_IDS = PORTAL_TABS.map((t) => t.id);

/**
 * Which tab a desk opens on. Every desk id here must exist in
 * ROLES and every tab id must exist in PORTAL_TABS; `npm test`
 * checks both directions, so adding a kind without a landing tab fails
 * rather than silently landing that person on the default.
 */
const OPENS_ON = {
  lead_dev: 'dev',
  dev: 'dev',
  accessibility: 'dev',
  moderating: 'moderation',
  testing: 'dev',
  group: 'orgs',
  policy: 'moderation',
  translation: 'voice',
  design: 'voice',
  outreach: 'comms',
};

const ROLES = [
  // id, label, group
  ['lead_dev', 'Lead developer', 'building'],
  ['dev', 'Developer, supporting', 'building'],
  ['accessibility', 'Accessibility', 'building'],
  ['moderating', 'Moderating reports', 'running'],
  ['testing', 'Testing the site before it is public', 'running'],
  ['group', 'Bringing an organization onto the record', 'orgs'],
  ['policy', 'Policy or legal', 'other'],
  ['translation', 'Translation', 'other'],
  ['design', 'Design or writing', 'other'],
  ['outreach', 'Outreach', 'other'],
];

export const DESKS = ROLES
  .map(([id, label, group]) => ({ id, label, group, opensOn: OPENS_ON[id] || 'start' }));

export const DESK_IDS = DESKS.map((d) => d.id);

/** Keep only the desks that exist, and drop duplicates. Never throws. */
export function normalizeDesks(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((d) => String(d ?? '').trim()).filter((d) => DESK_IDS.includes(d)))];
}

/**
 * Which tab this person's portal opens on.
 *
 * Somebody holding several desks lands on the first one in DESKS order
 * rather than on an arbitrary member of a set. Somebody holding none lands
 * on "Start here", which is where a person with no stated job should begin.
 */
export function openingTab(desks) {
  const held = normalizeDesks(desks);
  const first = DESKS.find((d) => held.includes(d.id));
  return first ? first.opensOn : 'start';
}
