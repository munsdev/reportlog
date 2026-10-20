/**
 * The reporter's three switches, in the words "My reports" shows them. Kept
 * apart so the evidence page can name the switch that stops the asking in
 * exactly the words the reporter will find, without importing the page.
 */
import type { Permission } from '@reportlog/contracts';

export const PERMISSION_WORDS: Record<Permission, { label: string; hint: string }> = {
  contact_passing: {
    label: 'A moderator may pass my contact details to somebody who asks to follow up',
    hint: 'For example a journalist or a lawyer. Off unless you switch it on.',
  },
  attachment_publication: {
    label: 'The files I attached may be published',
    hint: 'Separate from the report’s words. Switching it off takes published files down.',
  },
  evidence_request: {
    label: 'An editor may contact me to ask for the evidence I said I have',
    hint: 'What you said you have is part of the report. Whether you want to be asked about it is this.',
  },
};
