/**
 * The operator's own imprint and privacy policy.
 *
 * FREE TEXT, AND NOTHING ELSE. What a legal notice must contain is decided
 * by the jurisdiction the deployment is run from, and a field list would be
 * this software claiming to know which fields those are. It does not. We
 * store what the operator wrote and publish it unchanged: no completeness
 * check, no warning that something is missing.
 *
 * NULL IS NOT AN EMPTY STRING. Null means nothing is published, and the
 * public page says exactly that. The outlines below are what the EDITOR
 * opens with, never what the public endpoint serves: somebody who opens
 * the editor, reads the outline and closes the tab must not have published
 * it. That is why they live here and not in a column default.
 *
 * BEHIND THE SITE PASSWORD like every other word on the site, once there is
 * one (workstream A): a gated deployment is a half-finished install, and
 * publishing its operator's address to anybody who finds the hostname buys
 * nothing. The obligation attaches when the site goes public, which is when
 * the gate lifts.
 */
import { MAX_LEGAL_TEXT } from '@reportlog/contracts';
import type { LegalKind } from '@reportlog/contracts';
import type { Checked } from './result.ts';

export { MAX_LEGAL_TEXT };

/** Whitespace alone is nothing published: one space is not an imprint. */
export function resolveLegalText(stored: string | null | undefined): string | null {
  const text = typeof stored === 'string' ? stored.trim() : '';
  return text || null;
}

/**
 * A labelled outline with bracketed blanks. Deliberately not prose: no
 * sentence here may pass for a finished notice, because the failure this
 * guards against is somebody publishing it.
 */
export const SKELETONS: Record<LegalKind, string> = {
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
 * What the editor is prefilled with, and which of the two it is. An editor
 * that cannot tell them apart cannot warn that saving publishes the outline.
 */
export function editorStartingText(
  stored: string | null | undefined,
  kind: LegalKind,
): { text: string; published: boolean } {
  const written = resolveLegalText(stored);
  return written === null
    ? { text: SKELETONS[kind], published: false }
    : { text: written, published: true };
}

/** Everything but the length is the operator's business. Cleared is stored as null. */
export function validateLegalText(raw: string): Checked<string | null> {
  if (raw.length > MAX_LEGAL_TEXT) {
    return {
      ok: false,
      error: `That is longer than this field holds (${String(MAX_LEGAL_TEXT)} characters).`,
    };
  }
  return { ok: true, value: raw.trim() ? raw : null };
}
