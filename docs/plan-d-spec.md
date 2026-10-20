# ElectionLog under Plan D: technical spec for the ReportLog rewrite

20 October 2026, revision 2 (afternoon: owner rulings on moderator access, link comments, link independence, uploads, Caddy). Casey Muns. Source: Plan D, revised (project file `claude/plan-d-page.html`).

This is a checklist for reviewing the ReportLog code. Every item is something the app MUST or MUST NOT do. Each has an ID so a review can answer it item by item: met, not met, or not yet built, with the file and line that shows it.

Not legal advice. No lawyer has reviewed it.

---

## How to use this in a review session

- Check each item against the code, not against comments or docs.
- For every MUST NOT, look for the path that would break it, not only the path that obeys it.
- Where an item says "test", there should be an automated test that fails if the rule is broken. If there isn't one, say so.
- Report what you actually found. Mark anything you assumed rather than verified.

---

## 1. The archive rules (carried over, unchanged)

| ID  | Rule                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The logbook is append-only. No code path issues UPDATE or DELETE against report rows. A correction is a new row pointing at what it corrects. Withdrawal flips a pointer, it does not remove a row. |
| A2  | A key is written into the hashed object only when it applies. An absent key and a null key hash differently. No code "tidies" this by always including optional keys.                               |
| A3  | The verifier and the code that builds the hashed object produce byte-identical objects for every report shape, including reports with and without a link. Test.                                     |
| A4  | The public transparency log is never rewritten. If something invalidates published proofs, that fact is published alongside them.                                                                   |
| A5  | Nothing is public until a moderator approves it. Test that an unapproved report appears in no public view, count, map, feed or export.                                                              |
| A6  | Migrations are additive only. Nothing changes how an existing report hashes.                                                                                                                        |
| A7  | One card asks one question. Nothing on the card in front of someone changes underneath them. If an answer changes what gets asked, that happens on the next card. No auto-advance on selection.     |

---

## 2. Entry point

| ID  | Rule                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | One "File" entry point.                                                                                                                                                            |
| E2  | The first card asks one question with two answers: "I was at a polling place" leads to the logbook form. "I have a link or tip about something I wasn't at" leads to the tip form. |
| E3  | Choosing an answer does not advance by itself. The person confirms on that card.                                                                                                   |

---

## 3. The logbook (one logbook, good and bad)

| ID  | Rule                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1  | There is one logbook. Good and bad reports live in the same chain. There is no separate check-in logbook and no private logbook.                                                                                                           |
| L2  | The first card of the logbook form asks how it went, with answers equivalent to "it went fine" and "I had a problem". Later cards follow from that answer, each on its own card.                                                           |
| L3  | Every question in the logbook is multiple choice from a fixed preset list. The code may support text question types for other uses, but the logbook asks none. The server refuses a logbook filing that carries a text answer. Test.       |
| L4  | Fields: state, county, when, who they were there as, how it went, what happened (fixed list), how long they waited, whether they voted. Plus one optional link (section 5).                                                                |
| L5  | No preset names a person. No field accepts a polling place name.                                                                                                                                                                           |
| L6  | File uploads are switched off site-wide and no logbook or list asks a file question. The upload code may stay in the system, unused. While the switch is off, any filing carrying a file is refused and nothing is stored. Test, required. |
| L7  | The server rejects any submitted key that is not in the schema. Unknown fields are not stored. Test.                                                                                                                                       |
| L8  | Every report is sealed into the chain on filing, as now.                                                                                                                                                                                   |

---

## 4. Tips (separate from the logbook)

| ID  | Rule                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Tips are stored apart from the logbook, in their own table. They are not part of the chain and are not hashed into it.                                                                                                                                          |
| T2  | A tip holds up to three links, an optional comment, and an optional follow-up email. Nothing else. No file upload.                                                                                                                                              |
| T3  | Tips use the list's existing erasure: the personal half of each entry (email, comment) is erased on a timer and the row stays. Tip links in the private link store are erased with it: value and key destroyed, no tombstone. State the backup rotation period. |
| T4  | Tips never appear in any public view, count, map, feed or export. Test.                                                                                                                                                                                         |
| T5  | The tip comment is readable by the owner and by moderators. It is never readable by journalists, through any route. Test.                                                                                                                                       |
| T6  | Tip links follow every rule in section 5.                                                                                                                                                                                                                       |

---

## 5. Links (on reports and on tips)

| ID  | Rule                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | A link field accepts only http and https URLs. Anything else is rejected. Length is capped.                                                                                                                                                                                                                                                                                                                    |
| K2  | This text appears directly above every link field, on reports and tips: "Any link you add here may be shared with vetted journalists after a moderator checks it. It is never published. Don't link to your own account if you want to stay anonymous."                                                                                                                                                        |
| K3  | There is no consent checkbox for sharing. Adding a link means it can be shared. The field is optional.                                                                                                                                                                                                                                                                                                         |
| K4  | Links never appear in any public view, count, map, feed, export, page source, API response, or published fingerprint input. All public reads go through one shared filter that excludes links. Test that fails if any public query bypasses the filter.                                                                                                                                                        |
| K5  | The link value is stored outside the report row, in its own table, keyed to the report. The report's hashed object holds only a fingerprint of the link plus a random value stored with it, never the link itself. A guessed link cannot be matched to a report from published data. Test.                                                                                                                     |
| K6  | The server never fetches a link. No previews, thumbnails, title lookups, link checks, or unfurling, anywhere, including in moderator and journalist views and in alert emails. Links render as plain text or as an anchor with rel="noopener noreferrer nofollow" and no prefetch.                                                                                                                             |
| K7  | A link is readable only by the owner, moderators, and vetted journalists (section 7). Test each role, including logged-out, public, and unvetted journalist.                                                                                                                                                                                                                                                   |
| K8  | A link can be erased (section 8) without touching the report row. After erasure, the link value is gone, its fingerprint stays in the report, and a tombstone row records the removal.                                                                                                                                                                                                                         |
| K9  | Each link value is encrypted under its own key, so destroying the key erases it everywhere, including backups.                                                                                                                                                                                                                                                                                                 |
| K10 | Links are independent of reports. A report can be rejected while its link stays in the check queue, because a junk report can carry a valid link. The link check decides what journalists see.                                                                                                                                                                                                                 |
| K11 | Duplicate links are grouped. Each link stores a matching key: a keyed hash, with a server-held secret, of a normalized address (lower-case scheme and host, default port and trailing slash removed, query and fragment kept). The matching key is never published. Every filing keeps its own row. The check queue and the journalist desk show one entry per group, with how many reports and tips carry it. |
| K12 | A check covers its group, including later copies. A later copy of an "illegal" link is blocked and erased on arrival. A later copy of a "withheld" link is withheld. A moderator can re-check a group at any time, since the page behind a link can change.                                                                                                                                                    |

---

## 6. Moderation

| ID  | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Moderators approve or reject logbook reports. Rejection sends the filer an email with a reason (section 9).                                                                                                                                                                                                                                                                                                                                                                     |
| M2  | Batch approval exists for logbook reports, so a moderator can approve many multiple-choice reports at once without a written reason for each. Each approval is still recorded per report, with who approved and when.                                                                                                                                                                                                                                                           |
| M3  | Every link group, on reports and tips together, has a moderator check with exactly three outcomes: "checked", "withheld" (legal but abusive, worthless or harassing: never shown to journalists, not erased), or "illegal".                                                                                                                                                                                                                                                     |
| M4  | Existing moderator notes stay (editorial notes, reasons for opening contact details). The link check also allows one short comment per link group, capped in length, visible only to moderators, the owner and vetted journalists, never on any public page, download or API. Above the box: "Journalists will read this. Facts about the link only. Don't name or describe any person, and nothing about who filed it." Every edit is recorded with who and when, append-only. |
| M5  | A link reaches journalists only when its group's check outcome is "checked". Test.                                                                                                                                                                                                                                                                                                                                                                                              |
| M6  | "Withheld" blocks the group from journalists until a re-check. "Illegal" blocks it permanently and starts the erasure flow (section 8).                                                                                                                                                                                                                                                                                                                                         |
| M7  | Moderators see report answers, links and tip comments. Moderators can open a filer's email address only through a logged access with a written reason (section 10). Journalists and the public never can. Test.                                                                                                                                                                                                                                                                 |
| M8  | A moderator account cannot act until the current version of the moderator agreement has been accepted. Acceptance is recorded with version and time. The agreement covers confidentiality, opening emails only when needed and never copying or sharing them, and the rules for link comments.                                                                                                                                                                                  |
| M9  | Moderators who can open email addresses are Europe-based. Operational rule, not code: noted here so the agreement and onboarding carry it.                                                                                                                                                                                                                                                                                                                                      |

---

## 7. Journalists

### 7a. Alert list (can ship first)

| ID  | Rule                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| J1  | A public signup page collects name, outlet, email, and coverage area (states). Nothing else.                                                                       |
| J2  | Double opt-in: an address is only on the list after the confirmation link is clicked.                                                                              |
| J3  | Alert emails say there are new reports in the subscriber's area. They contain no links to submitted material, no report content beyond counts, and no tip content. |
| J4  | Every alert email has a working unsubscribe link. Unsubscribing removes the address from the list.                                                                 |
| J5  | Being on the alert list grants no access to anything that is not public.                                                                                           |
| J6  | The signup page carries the legal notice and privacy policy links.                                                                                                 |

### 7b. Vetted access

| ID  | Rule                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| J7a | Any alert list subscriber can ask for journalist access from their subscription. The request form takes text and links only: outlet, role, links to published work under their name, and optionally a press card number and issuing body. No file upload.                                                                                                          |
| J7b | Requests appear in an owner-only queue in the admin dashboard. The owner approves or rejects each one. There is no automatic approval.                                                                                                                                                                                                                             |
| J7  | Only the owner can approve a journalist. Approval is recorded with who and when. A rejected request's verification details are deleted, and the person stays on the alert list unless they unsubscribe.                                                                                                                                                            |
| J8  | A vetted journalist cannot see anything until the current version of the journalist agreement has been accepted. Acceptance is recorded with version and time. A new agreement version blocks access until it is accepted again.                                                                                                                                   |
| J9  | A vetted journalist sees one entry per checked link group (K11), with how many reports and tips carry it and the moderator's link comment (M4). Report links: state, county and time while the report is unapproved or rejected; once the report is approved, also its ticked answers and category. Tip links: whatever multiple-choice context the tip form asks. |
| J10 | A journalist never sees: email addresses, tip comments, unchecked, withheld or illegal links, moderator notes other than the link comment, or anything else that identifies the person who filed. Test.                                                                                                                                                            |
| J11 | Journalist access is read-only. No bulk download, no export, no API listing beyond what the desk pages show. Pages are paginated.                                                                                                                                                                                                                                  |
| J12 | Every time a journalist opens a link or a report, an access log row is written with who and when.                                                                                                                                                                                                                                                                  |
| J13 | The owner can revoke a journalist. Revocation takes effect on the next request.                                                                                                                                                                                                                                                                                    |

---

## 8. Erasure of illegal links

| ID  | Rule                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| X1  | When a link is marked illegal, the server does not download, store, copy or forward what it points to.                                                                                                                                                                                                 |
| X2  | Erasure destroys the link value and its key in the separate link store (K5, K9). The report row is never updated or deleted. Backups then hold only encrypted values whose key is gone.                                                                                                                |
| X3  | Erasure appends a tombstone row: which report and link, when, who, and the reason category. Tombstones are append-only like reports. The report keeps its link fingerprint, so the chain still verifies. Public views show that a link was removed from that report and when, never what it was. Test. |
| X3a | Tombstones apply only to logbook links. Tip links are erased without a tombstone, since tips are outside the chain (T3). Email key destruction (I5) needs no tombstone, because emails are not in the chain. Withdrawal stays a pointer flip (A1).                                                     |
| X4  | Erasure writes an access log row with who, when, and the reason category.                                                                                                                                                                                                                              |
| X5  | The handling procedure, outside the code, is: report the link to a hotline (internet-beschwerdestelle.de or jugendschutz.net), then erase. The code does not need to automate the report, but the moderator screen links to the procedure.                                                             |

---

## 9. EU platform rules (Digital Services Act)

| ID  | Rule                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | A public form lets anyone report illegal content. It confirms receipt by email if an address is given, and the decision is sent back.                               |
| D2  | Every rejected report and every removed link sends the filer an email with the reason, chosen from a fixed list plus the terms-of-use clause it relates to.         |
| D3  | Reasons emails go to the filer's verified address without showing it to the moderator who made the decision. A moderator can still open it separately, logged (M7). |
| D4  | Public pages link to: the terms of use, the contact point for users, the contact point for authorities, the legal notice, and the privacy policy.                   |
| D5  | Moderators can flag a report or tip as "threat to life or safety", which notifies the owner immediately.                                                            |

---

## 10. Identity and email

| ID  | Rule                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Every filing, on the logbook and tips, requires an email with a confirmation link before it counts.                                                                                                                                         |
| I2  | Email addresses are encrypted at rest, each under its own key.                                                                                                                                                                              |
| I3  | Email addresses are readable by the owner and by moderators, each read through a logged access with a written reason. Journalists and the public never can. This keeps the existing rule. It can be narrowed to owner-only later if needed. |
| I4  | Every read of an email address, by the owner or a moderator, writes an access log row with who, when and a written reason.                                                                                                                  |
| I5  | The person who filed can have their email key destroyed through a link in their confirmation email. After destruction, nobody, including the owner, can read the address. The owner cannot undo it. Test.                                   |
| I6  | Email addresses never appear in logs, error messages, analytics, alert emails to journalists, or any page except the logged identity view open to the owner and moderators.                                                                 |

---

## 11. Public side

| ID  | Rule                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Public pages show: approved reports as ticked answers, counts and maps by state, county, category and hour, good and bad side by side, and the fingerprints. |
| P2  | Public pages never show: links, link comments, tips, tip comments, email addresses, check outcomes, moderator identities, or any unapproved report.          |
| P3  | Wherever a number appears, this line appears with it: "These are reports people chose to file. They are not a sample and cannot be read as a rate."          |
| P4  | Anyone can verify the chain with the published fingerprints and the verifier, without access to links or emails.                                             |

---

## 12. Server and logging

| ID  | Rule                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | The web server's access logs do not store IP addresses.                                                                                                                                                                                                                       |
| S2  | Application logs and error tracking do not store IP addresses, email addresses, or link values.                                                                                                                                                                               |
| S3  | Every page route works in production, not only in testing. The rebuild's web server (Caddy) sends every page request to the app through one catch-all, so new routes need no config change. Record that decision, and keep a test that runs page routes through a real Caddy. |
| S4  | The server stays in the EU.                                                                                                                                                                                                                                                   |

---

## 13. What the app must not have at all

A review should confirm each of these. Two are met by configuration and a test rather than by absence, by the owner's decision.

- No file accepted anywhere: uploads switched off, and a test proves a file is refused (L6).
- No free-text question in the logbook, and a test proves a text answer is refused (L3).
- No automatic link fetching, previews or unfurling.
- No public display of any link or link comment.
- No journalist view of tip comments, email addresses, or withheld or illegal links.
- No bulk export for journalists.
- No UPDATE or DELETE on report rows.
- No auto-advance on any card.

---

## 14. Order the pieces are needed

1. **Alert list:** J1 to J6. Can ship before anything else.
2. **Reporting opens:** sections 1 to 6 (except the journalist link release in M5), 8, 9, 10, 11, 12.
3. **Journalist access to links:** M5, J7 to J13.

---

## 15. Known limitations, precisely

- Whether the EU platform rules apply to an unpaid private site is unsettled. This spec assumes they do.
- Moderators opening email addresses (M7, I3) means each one is a person a court could ask to testify. The German right to refuse to name sources probably does not cover volunteers. Accepted for now; can be narrowed to owner-only.
- The link comment (M4) is a statement passed to journalists. Its rules live in the moderator agreement.
- Whether a checked link group should expire and need a re-check after some time. Manual for now.
- Whether the tip email is optional. Today a list may require one; making it optional changes I1 for tips.
- What multiple-choice context the tip form asks (J9). Not yet decided.
- The backup rotation period, for tips (T3).
- How long links, tips and emails are kept is not yet decided. Retention needs its own items once decided.
- The final preset list is not yet decided. L4 names the fields, not the options.
