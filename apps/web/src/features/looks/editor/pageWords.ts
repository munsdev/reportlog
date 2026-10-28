/**
 * Which wording slots each public page shows, so the corner Edit menu can
 * offer "Edit this page's words" on it (EditDock.tsx). Only the Front page,
 * About and Get involved are built from blocks (decision 79); every other
 * page's text is fixed in code apart from these slots, which were editable
 * only from Settings › Wording.
 *
 * By address and by the slot's key, from where each page reads it: a slot
 * the server does not offer is left out when the panel opens.
 */
const PAGES: readonly { path: string; prefix?: boolean; slots: readonly string[] }[] = [
  { path: '/', slots: ['home_headline', 'home_lede', 'home_intro'] },
  { path: '/about', slots: ['about_archive'] },
  {
    path: '/submit',
    slots: [
      'submit_intro',
      'submit_question',
      'send_note',
      'refusal_message',
      'intake_paused_notice',
    ],
  },
  {
    path: '/board',
    prefix: true,
    slots: ['board_intro', 'origin_open_form', 'origin_organization'],
  },
  { path: '/how', slots: ['how_intro'] },
  { path: '/organizations', slots: ['alliance_intro'] },
  { path: '/standards', slots: ['standards'] },
  { path: '/terms', slots: ['terms_of_use', 'contact_users', 'contact_authorities'] },
];

/** The wording slots on the page at this address, or none. */
export function slotsOn(pathname: string): readonly string[] {
  const path = pathname.replace(/\/+$/, '') || '/';
  const page = PAGES.find((p) =>
    p.prefix ? path === p.path || path.startsWith(`${p.path}/`) : path === p.path,
  );
  return page?.slots ?? [];
}
