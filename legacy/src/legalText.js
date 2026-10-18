/**
 * The operator's own Impressum and privacy policy.
 *
 * Both panes have always said that an operator publishes their own text
 * there, and there was no way for one to do it. This is that way.
 *
 * FREE TEXT, AND NOTHING ELSE. A structured version was designed first — a
 * mode flag, a field list, include checkboxes, the notice assembled from
 * parts — and was reversed deliberately. What a legal notice must contain
 * is decided by the jurisdiction the deployment is run from, and a field
 * list is this software asserting that it knows which fields those are. It
 * does not, it cannot, and being confidently wrong about it is worse than
 * being silent. The operator owns their legal notices; we store what they
 * wrote and publish it unchanged.
 *
 * So: no validation, no completeness check, no warning that something is
 * missing. There is nothing this software could check against.
 *
 * NULL IS NOT AN EMPTY STRING. NULL means nobody has written one yet, and
 * the public pane says exactly that. The starting skeleton below is served
 * to the ADMIN EDITOR as prefilled text and is never published by itself,
 * which is the whole reason it lives here rather than in the column
 * default: an operator who opens the editor, reads the outline and never
 * finishes must not have published our dummy as their own legal notice.
 *
 * NEVER HASHED. Presentation, like the site's name. Nothing in
 * reportCore.js or verify.js may read these: a report must not verify
 * differently because somebody corrected their privacy policy.
 */
import { pool } from './db.js';

export const LEGAL_KINDS = ['impressum', 'privacy'];

/**
 * A ceiling, not a rule about content.
 *
 * There is no length a legal notice has to be and this does not pretend
 * otherwise — it is a bound on what one admin can write into one row, far
 * above any real policy, so that the column cannot be used as storage. The
 * request body limit (256kb, server.js) already bounds this loosely; this
 * says the number out loud instead of letting a JSON parser decide it.
 */
export const MAX_LEGAL_TEXT = 100000;

const COLUMN = { impressum: 'impressum_text', privacy: 'privacy_text' };

const SETTINGS_TTL_MS = Number(process.env.LEGAL_TEXT_TTL_MS ?? 30 * 1000);
let cache = { at: 0, row: null };

export async function legalSettings() {
  if (Date.now() - cache.at < SETTINGS_TTL_MS) return cache.row;
  try {
    const { rows } = await pool.query(
      'SELECT impressum_text, privacy_text FROM site_settings WHERE id = true',
    );
    cache = { at: Date.now(), row: rows[0] || null };
  } catch {
    // A database that cannot answer must not invent a legal notice. A null
    // row reads as "not written yet", which is what every deployment looked
    // like before these columns existed and is the honest answer.
    cache = { at: Date.now(), row: null };
  }
  return cache.row;
}

export function clearLegalTextCache() {
  cache = { at: 0, row: null };
}

/**
 * Pure, so the NULL-versus-empty distinction is testable without a database.
 *
 * Whitespace alone resolves to nothing published, because a page containing
 * one space is not a published notice and an operator who cleared the box
 * meant to clear it.
 */
export function resolveLegalText(settings, kind) {
  const raw = settings ? settings[COLUMN[kind]] : null;
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text || null;
}

export async function legalText(kind) {
  return resolveLegalText(await legalSettings(), kind);
}

/**
 * What the editor opens with when nothing has been written.
 *
 * A labelled outline with bracketed blanks. Deliberately NOT prose: no
 * sentence here may be mistakable for a finished notice, because the
 * failure mode this is guarding against is somebody publishing the
 * skeleton. It names what many jurisdictions ask for and says, at the top,
 * that establishing which of them apply is the operator's job.
 */
export const SKELETONS = {
  impressum: `IMPRINT — outline to complete

This is a starting outline. It is not a legal notice, it is not legal
advice, and it is not complete. What your jurisdiction requires of this
page is yours to establish; take advice. Delete every line that does not
apply to you and add anything that does.

RESPONSIBLE ENTITY
  Name:          [legal name of the person or organisation running this site]
  Legal form:    [e.V., GmbH, Ltd, association, sole trader, …, or delete]

POSTAL ADDRESS
  [street and number]
  [postcode and town]
  [country]

CONTACT
  Email:         [an address a person actually reads]
  Telephone:     [number, if your jurisdiction requires one, or delete]

REGISTER ENTRY                                  [delete if not registered]
  Register:      [e.g. Handelsregister, Vereinsregister]
  Court:         [registering court]
  Number:        [registration number]

VAT IDENTIFICATION NUMBER                            [delete if not applicable]
  [VAT ID]

RESPONSIBLE FOR CONTENT       [where your jurisdiction names such a person]
  Name:          [name]
  Address:       [address, if it must be stated]

SUPERVISORY AUTHORITY              [where this deployment is subject to one]
  [authority and address]
`,
  privacy: `PRIVACY POLICY — outline to complete

This is a starting outline. It is not a policy, it is not legal advice, and
it is not complete. A policy describes what THIS deployment does with
particular people's data under a particular jurisdiction; only you can
write it. Take advice. Delete every line that does not apply and add
anything that does.

The headings below are the things this software does that a policy will
probably have to account for. They are prompts, not answers.

WHO IS RESPONSIBLE
  [entity and postal address — normally the same as the imprint]
  [contact address for data protection questions]
  [data protection officer, where one is required, or delete]

WHAT IS COLLECTED, AND WHY
  Reports:       [the contents of a report, and any files attached to it]
  Reporter identity and contact details:
                 [collected where a reporter gives them; stored encrypted
                  and readable only by a moderator, who must record a
                  written reason that is logged]
  Sign-in:       [email address and one-time codes for anybody with an
                  account here]
  Server logs:   [what your deployment's web server and this application
                  record, and for how long]

LAWFUL BASIS                          [where your jurisdiction requires one]
  [basis for each kind of data above]

WHO ELSE SEES IT
  [moderators and administrators of this deployment]
  [your hosting provider and, if attachments are enabled, your object
   storage provider — name them and say where they are]
  [your email provider]
  [anything published: say plainly what becomes public, and when]

HOW LONG IT IS KEPT, AND WHAT CANNOT BE ERASED
  [this archive is append-only: a report is never edited or deleted, a
   correction appends a new version, and a withdrawal moves a pointer.
   Say what that means for an erasure request before somebody makes one]
  [a daily snapshot of the archive is published and timestamped]

RIGHTS, AND HOW TO EXERCISE THEM
  [the rights your jurisdiction gives, and the address to write to]
  [how to complain to a supervisory authority, where one exists]

COOKIES
  [this site sets strictly necessary cookies only: a site-access token
   where the password gate is on, and a sign-in session. Check this against
   your own deployment before publishing it]

CHANGES TO THIS POLICY
  [how you will tell people]
`,
};

/**
 * What the editor should be prefilled with: what they wrote, or the
 * outline if they have written nothing. The caller is told which of the two
 * it got, because an editor that cannot tell them apart cannot warn that
 * pressing save publishes the outline.
 */
export function editorStartingText(settings, kind) {
  const written = resolveLegalText(settings, kind);
  return written === null
    ? { text: SKELETONS[kind], published: false }
    : { text: written, published: true };
}

export function validateLegalText(raw) {
  const value = String(raw ?? '');
  if (value.length > MAX_LEGAL_TEXT) {
    return { ok: false, error: `That is longer than this field holds (${MAX_LEGAL_TEXT} characters).` };
  }
  // Everything else is the operator's business. Whitespace alone is stored
  // as "nothing published" rather than refused, because clearing the box is
  // a thing somebody may legitimately want to do.
  return { ok: true, value: value.trim() ? value : null };
}
