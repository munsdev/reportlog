# Plan D: the approved build plan (revision 3)

> **Approved 2026-10-20.** Where this plan and `docs/plan-d-spec.md` (the spec, revision 2)
> differ, this plan wins: its "Spec changes to make" list is approved and applies to the spec.

20 October 2026, evening. Answers "ElectionLog under Plan D: technical spec for the ReportLog
rewrite", **revision 2**, item by item, and proposes the changes the owner agreed today. Prepared
from the ReportLog rebuild (`munsdev/reportlog`, branch `ccr-c9c93698-ev856l`, commit `d70e923`).

**Status key**

- **Met**: built, and as far as I know tested.
- **Setup**: met by how the operator configures ReportLog. No code change.
- **Change**: exists, but needs a code change.
- **New**: not built.
- **Removed**: the spec item no longer applies under the design below.
- **Check**: I believe the status shown, but it must be confirmed in the code.

**What this is based on.** I coordinated the rebuild and know what each workstream built,
plus the project's records (`docs/parity.md`, `docs/decisions.md`, `docs/status/*`). **This is
not a line-by-line code review.** No item has a file and line reference yet. The first step of
the plan is a review session that adds them and settles every **Check**.

---

## The design change in one paragraph

**Links come only through the Tip List. Logbook reports carry no links.** The logbook is what
the site publishes: hosted, sealed, chained, moderated, and a rejection emails the filer with a
reason. The Tip List is a contact form to the site's operators: tips and their links are
messages, never published, never sealed, and can be deleted freely. After filing a report,
the person is pointed to the tip form if they have a link ("Have a link, photo or video? Send
it as a tip."), and the browser can fill in the tip's state, county and time from the report
just filed, without the server ever connecting the two. Checked tip links reach vetted
journalists through the desk.

**Why.** It keeps the sealing code untouched (the riskiest code in the project). It removes
tombstones and the report-approval question for links. And it puts the legal framing in the
structure itself: only the logbook is hosted for publication.

**What is given up.** (1) A report's answers beside a link; the tip form's own multiple-choice
questions replace them. (2) Someone at a polling place with a video files twice: a report, then
a tip. (3) Proof that a link was part of a report on a given date, since links are not sealed.

---

## Owner decisions behind this revision (20 Oct)

| Topic                      | Decision                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Uploads (L6)               | Stay in the code, **switched off** site-wide; a filing carrying a file is refused; test.                                    |
| Free text (L3)             | Logbook **setup** asks none; the server refuses a text answer; test.                                                        |
| Unknown keys (L7)          | **Refused**, not silently dropped; test.                                                                                    |
| Moderator notes (M4)       | Existing notes stay. Plus one short comment per link group, for journalists.                                                |
| Emails (M7, I3)            | Owner and moderators may open an email through a logged access with a written reason. Journalists and the public never.     |
| Tips (T1 to T4)            | Stay a **separate list** with publishing off; the list's existing erasure is used.                                          |
| Links                      | **Only on tips.** Never on logbook reports.                                                                                 |
| Duplicates                 | Grouped by a private matching key (K11).                                                                                    |
| Blocklist                  | **New.** Moderators block links by exact address or by domain (including subdomains). A matching link is erased on arrival. |
| "Illegal" and later copies | **No automatic carry-over.** Only the blocklist blocks later copies.                                                        |
| Removing a link or tip     | **No email** to the filer. The terms of use say links and tips may be checked, withheld, removed and reported.              |
| Report rejection (M1)      | **Still emails** the filer with a reason.                                                                                   |
| Caddy (S3)                 | One catch-all route; a test runs page routes through a real Caddy.                                                          |

---

## 1. The archive rules

| ID                                                              | Status                                     | Notes                                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 Append-only; correction = new row; withdrawal = pointer      | **Met**                                    | Database triggers refuse UPDATE, DELETE and TRUNCATE on `reports`; corrections are new rows in the thread; withdrawal is a flag on `report_heads`. Tested by the invariant sweep. |
| A2 Key only when it applies                                     | **Met**                                    | Conditional keys in `packages/seal/src/report.ts`, tested against fingerprints the old app produced.                                                                              |
| A3 Verifier and builder byte-identical, with and without a link | **Met. The "with a link" part is Removed** | Reports carry no links, so no new report shape.                                                                                                                                   |
| A4 Transparency log never rewritten                             | **Met**                                    |                                                                                                                                                                                   |
| A5 Nothing public until approved; test every surface            | **Met, Check the coverage**                | One rule (`apps/api/src/board/published.ts`) feeds board, chain file, snapshot, maps and exports. Confirm a test covers each surface, including digests and alerts.               |
| A6 Migrations additive                                          | **Met**                                    | No change to how any report hashes: the seal is untouched by this plan.                                                                                                           |
| A7 One card, one question, no auto-advance                      | **Met**                                    |                                                                                                                                                                                   |

## 2. Entry point

| ID                                                                                                                                            | Status                            | Notes                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 One "File" entry point                                                                                                                     | **Setup / Check**                 | The front page shows one button per open logbook and list, in an operator-set order. One "File" button leading to the chooser is setup, or a small change (Check).                 |
| E2 First card: "I was at a polling place" or "I have a link or tip…"                                                                          | **Change (small)**                | `/submit` lists open logbooks and lists today; make it one card with one question, two answers and a confirm button.                                                               |
| E3 No auto-advance                                                                                                                            | **Met** once E2 is a normal card. |
| **E4 (new)** After a report is filed, its last card and receipt say "Have a link, photo or video? Send it as a tip." and link to the tip form | **New (small)**                   |                                                                                                                                                                                    |
| **E5 (new)** The tip form can be pre-filled in the browser with the state, county and time from the report just filed                         | **New (small)**                   | The values travel in the browser only. The server receives no reference to the report and never connects a tip to a report. Test that no report identifier reaches the tip filing. |

## 3. The logbook

| ID                                                          | Status                                         | Notes                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 One logbook, good and bad                                | **Setup**                                      |                                                                                                                                                                                                                                                                         |
| L2 "How did it go" first; later cards follow                | **Setup**                                      | Conditional questions are built and sealed with the form.                                                                                                                                                                                                               |
| L3 Multiple choice only; server refuses a text answer; test | **Setup + test**                               | If the logbook asks no text question, a text answer can arrive only under a key the form doesn't ask (refused by L7), or inside a choice field (already refused: the answer must be one of the options). So this needs **tests**, not new code. Check the second claim. |
| L4 The listed fields                                        | **Setup. "Plus one optional link" is Removed** | Links come only through tips. Final presets are still open.                                                                                                                                                                                                             |
| L5 No person named; no polling-place name                   | **Setup**                                      |                                                                                                                                                                                                                                                                         |
| L6 Uploads off; a filing with a file refused; test          | **Setup + Check + test**                       | The site-wide files switch exists. Confirm a filing carrying a file is refused while it is off, and add the required test.                                                                                                                                              |
| L7 Unknown keys refused; test                               | **Change (small)**                             | Believed to be silently dropped today (Check). Refuse in plain words; test.                                                                                                                                                                                             |
| L8 Sealed on filing                                         | **Met**                                        |                                                                                                                                                                                                                                                                         |

## 4. Tips: the contact form

| ID                                                                                                        | Status                              | Notes                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 Separate table; not chained, not hashed                                                                | **Met**                             | Lists: own tables; the boundary check forbids lists reaching the seal or chain code.                                                                                |
| T2 Up to three links, optional comment, optional email; no upload                                         | **Setup + New**                     | The Tip List form is configurable. The **link field** is the new private link type (§5), up to three per tip. Whether the email can be optional is still open (I1). |
| T3 List erasure on a timer; tip links erased with it (value and key destroyed); state the backup rotation | **Met for the list; New for links** | The rotation period must be written down.                                                                                                                           |
| T4 Never public, no counts; test                                                                          | **Setup + Check + test**            | Publishing off. Confirm "off" means no counts anywhere (board figures, maps, digests, alerts, `/api/v1`), with a test.                                              |
| T5 Comment readable by owner and moderators, never journalists; test                                      | **New** (with §7)                   |                                                                                                                                                                     |
| T6 Tip links follow §5                                                                                    | **New**                             |                                                                                                                                                                     |
| **T7 (new)** The tip form asks its own multiple-choice context: state, county, time, and what it is about | **Setup**                           | This is what journalists see beside a link (J9). Exact questions still open.                                                                                        |

## 5. Links (tips only)

| ID                                                                                                                    | Status                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1 http and https only; length capped                                                                                 | **New** (small)                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| K2 The fixed wording above every link field                                                                           | **New** (small)                   | Part of the field type, so every form that uses it shows it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| K3 No consent checkbox                                                                                                | **New** (by design)               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| K4 Never in any public view, count, map, feed, export, page source, API or fingerprint input; one shared filter; test | **New, simpler**                  | Links live only in lists, and tips are never public, so the risk is a list surface or `/api/v1` leaking. Add a sweep test over every public route and download that fails if a link value appears.                                                                                                                                                                                                                                                                                                                                                                                           |
| K5 Stored outside the report; fingerprint plus random value in the seal                                               | **Removed**                       | Links are never sealed. They still live in their own store (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| K6 Never fetched; plain text or a safe anchor                                                                         | **Met today (Check)**; add a test | Nothing fetches answers today. Links render as text, or as an anchor with `rel="noopener noreferrer nofollow"` and no prefetch.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| K7 Readable only by owner, moderators, vetted journalists; test each role                                             | **New**                           | Roles tested: owner, moderator, vetted journalist (checked links only), unvetted journalist, signed-in public, logged out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| K8 Erasure without touching the report row; tombstone                                                                 | **Removed**                       | There is no report row. Erasure deletes the value and its key (X2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| K9 Each value encrypted under its own key                                                                             | **New**                           | The contact-key method used for emails today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| K10 Links independent of reports                                                                                      | **Removed** (moot)                | Links have no report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| K11 Duplicates grouped by a keyed-hash matching key; never published; one entry per group in the queue and the desk   | **New**                           | Normalization: lower-case scheme and host; default port and trailing slash removed; query and fragment kept. Every tip keeps its own row.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| K12 A check covers its group                                                                                          | **Change from the spec**          | "Checked" and "withheld" cover the group's live copies and carry over to later copies. **"Illegal" does not carry over**: the blocklist (K13) is how later copies are stopped. After an illegal link is erased, its matching key is destroyed too, unless a moderator blocklisted it. A moderator can re-check a group at any time.                                                                                                                                                                                                                                                          |
| **K13 (new)** Blocklist                                                                                               | **New**                           | Moderators add entries by **exact address** or by **domain**, from the link check or at any time. Entries are stored as **keyed hashes, never plain addresses**, so the database and backups hold no readable list of illegal links. Exact entries use the matching key; for domains, the server hashes the incoming host and each parent domain, so a domain entry covers its subdomains. A tip link that matches is **erased on arrival** (value and key destroyed), never queued, never shown. Adding or removing an entry is recorded with who, when and a reason category, append-only. |

**Storage.** One module (for example `apps/api/src/links/`) holds every link: keyed to a list
entry, encrypted under its own key, with its matching key, its group's check outcome, and the
group's moderator comment. Lists use it; it never imports the seal or chain code.

## 6. Moderation

| ID                                                                                                              | Status                                                     | Notes                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| M1 Approve or reject reports; rejection emails a reason                                                         | **Met for approve and reject; Check/Change for the email** | Confirm whether rejection emails the filer. If not, add it with the D2 reason list.                                  |
| M2 Batch approval of reports, recorded per report                                                               | **Change** (Check first)                                   | Lists have batch approval; reports are believed to be one at a time.                                                 |
| M3 Link check per group: "checked", "withheld", "illegal"                                                       | **New**                                                    | Tip links only.                                                                                                      |
| M4 Existing notes stay; one short comment per link group for journalists, with the warning line; edits recorded | **New** for the comment                                    | Capped length; visible to moderators, the owner and vetted journalists only; never public. Edit history append-only. |
| M5 Journalists see a link only when its group is "checked"; test                                                | **New**                                                    |                                                                                                                      |
| M6 "Withheld" blocks until a re-check; "illegal" blocks permanently and starts erasure                          | **New**                                                    | "Permanently" means this copy is erased; later copies are stopped only if blocklisted (K12, K13).                    |
| M7 Moderators open emails only through a logged access with a reason; journalists and public never; test        | **Met (Check the test)**                                   | Existing behaviour.                                                                                                  |
| M8 Moderator agreement, versioned, accepted before acting                                                       | **New**                                                    | Append-only agreement texts, an acceptance log, a guard on every moderator scope.                                    |
| M9 Email-opening moderators are Europe-based                                                                    | **Not code**                                               | Agreement and onboarding.                                                                                            |

## 7. Journalists

### 7a. Alert list

**Partly exists.** The email digests (hourly and weekly) send what the board published, and
they carry **report content**, which J3 forbids. Their stop link works without signing in and
changes nothing until a button is pressed.

| ID                                                     | Status         | Notes                                                                                                |
| ------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------- |
| J1 Signup: name, outlet, email, coverage states        | **Done** (PD2) | A journalist signup, separate from (or a variant of) the digest.                                     |
| J2 Double opt-in                                       | **Done** (PD2) | Confirm the digest signup confirms by link before listing; add a browser test that follows the link. |
| J3 Counts only, by area; no links, no content, no tips | **Done** (PD2) | A counts-only alert per subscriber's states, from the published rule (approved reports only).        |
| J4 Working unsubscribe                                 | **Done** (PD2) | The digest stop link.                                                                                |
| J5 No access to anything non-public                    | **Done** (PD2) |                                                                                                      |
| J6 Legal notice and privacy links on signup            | **Done** (PD2) | The site footer.                                                                                     |

### 7b. Vetted access

| ID                                                                                                                       | Status              | Notes                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| J7a Access request from the subscription: text and links only                                                            | **New**             |                                                                                                                             |
| J7b Owner-only queue; no automatic approval                                                                              | **New**             |                                                                                                                             |
| J7 Only the owner approves; recorded; rejected details deleted; stays subscribed                                         | **New**             | A `journalist` grant only the owner can make, enforced in `packages/access` like the administrator seat.                    |
| J8 Journalist agreement, versioned; a new version blocks access until accepted                                           | **New**             | Same mechanism as M8.                                                                                                       |
| J9 One entry per checked link group, with the count of tips carrying it and the moderator's comment                      | **New, simplified** | Beside each link: the tip form's multiple-choice context (T7). Report context is **Removed**, since reports carry no links. |
| J10 Never: emails, tip comments, unchecked, withheld or illegal links, other moderator notes, anything identifying; test | **New**             |                                                                                                                             |
| J11 Read-only; no export; paginated                                                                                      | **New**             |                                                                                                                             |
| J12 Access log row for each link opened                                                                                  | **New**             | Extends the existing staff access log.                                                                                      |
| J13 Owner revokes; effective on next request                                                                             | **New**             | Roles are checked on every request.                                                                                         |

## 8. Erasure of illegal links

| ID                                                                 | Status                            | Notes                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| X1 Never download, store, copy or forward the target               | **Met today (Check)**; add a test |                                                                                                                                        |
| X2 Destroy the value and its key                                   | **New, simplified**               | Deletes the value and its key in the link store. Backups then hold only ciphertext whose key is gone. No report row exists to protect. |
| X3 Tombstone; fingerprint stays; public shows "a link was removed" | **Removed**                       | Links are never sealed or public, so there is nothing to tombstone.                                                                    |
| X3a Tombstones only for logbook links                              | **Removed**                       |                                                                                                                                        |
| X4 Access log row with who, when and reason category               | **New**                           |                                                                                                                                        |
| X5 Moderator screen links to the hotline procedure                 | **New** (small)                   |                                                                                                                                        |

## 9. EU platform rules

**Framing (for the terms of use and the spec):** the logbook is hosted for publication. The Tip
List is a contact form: tips and links are messages to the site's operators, never published.
Passing a checked link to a small group of vetted journalists is treated as forwarding a
message, not publishing it.

| ID                                                                                        | Status                    | Notes                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 Public form to report illegal content; receipt and decision by email                   | **New**                   | Its own form, queue, receipt and decision email. The feedback form is a starting point.                                                                                                                                                   |
| D2 Reasons                                                                                | **Change from the spec**  | A **report rejection** emails the filer the reason from a fixed list, with the terms clause. **Removing a link or a tip sends nothing**; the terms of use say links and tips may be checked, withheld, removed and reported to a hotline. |
| D3 Reasons email without showing the address to the moderator                             | **Met by design (Check)** | Sent from the encrypted contact details; a moderator can still open them separately, logged (M7).                                                                                                                                         |
| D4 Terms, user contact, authority contact, legal notice, privacy linked from public pages | **Change**                | Legal pages and footer exist; add the terms of use and the two contact points as pages or copy slots.                                                                                                                                     |
| D5 "Threat to life or safety" flag notifies the owner at once                             | **New**                   | On reports and on tips.                                                                                                                                                                                                                   |

## 10. Identity and email

| ID                                                                                               | Status                               | Notes                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1 Every filing confirmed by email                                                               | **Met for reports; Check for lists** | Open: whether the tip email is optional.                                                                                                                                                      |
| I2 Encrypted, each under its own key                                                             | **Met**                              |                                                                                                                                                                                               |
| I3 Owner and moderators, logged with a reason; never journalists or public                       | **Met**                              |                                                                                                                                                                                               |
| I4 Every read logged with who, when, reason                                                      | **Met (Check owner reads)**          |                                                                                                                                                                                               |
| I5 Destroy the email key through a link in the confirmation email; irreversible; test            | **Check/Change**                     | Reporters can erase contact details; confirm a direct link exists in the confirmation email, that its page changes nothing until a button is pressed, and add a browser test that follows it. |
| I6 Never in logs, errors, analytics, journalist alerts, or pages beyond the logged identity view | **Mostly met (Check)**               | Error tracking already strips users; confirm for emails. Add link values to the same scrubbing (S2).                                                                                          |

## 11. Public side

| ID                                                                                                                | Status                        | Notes                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| P1 Approved reports, counts and maps by state, county, category and hour, good and bad side by side, fingerprints | **Met / Setup; Check "hour"** | Filters exist only where the operator turns them on.                                      |
| P2 Never links, link comments, tips, emails, check outcomes, moderator identities, unapproved reports             | **Met + New**                 | Links and comments live only in the tip side and the link store; covered by the K4 sweep. |
| P3 The "not a sample" line beside every number                                                                    | **Change**                    | Probably one component beside every figure, map and count, with a test.                   |
| P4 Verify without links or emails                                                                                 | **Met**                       | The seal is unchanged by this plan.                                                       |

## 12. Server and logging

| ID                                                            | Status                                     | Notes                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| S1 Web-server logs hold no IP addresses                       | **Check**                                  | The app's logs hold none; confirm Caddy's log format.                                                               |
| S2 No IP, email or link values in logs or error tracking      | **Met for IP; Check email; New for links** |                                                                                                                     |
| S3 One catch-all route, recorded; tested through a real Caddy | **Met (Check)**                            | The operations tests already run the shipped Caddyfile in a real Caddy; record the decision in `docs/decisions.md`. |
| S4 EU                                                         | **Met by plan**                            | Hetzner. The daily update check reaches GitHub (US) by an earlier owner decision.                                   |

## 13. Must not have

| Item                                                                  | Status                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| No file accepted anywhere (switch off + test)                         | **Setup + test** (L6)                                                                  |
| No free-text question in the logbook (+ test)                         | **Setup + test** (L3)                                                                  |
| No automatic link fetching                                            | **Met (Check) + test**                                                                 |
| No public link or link comment                                        | **New** (K4 sweep)                                                                     |
| No journalist view of tip comments, emails, withheld or illegal links | **New** (J10)                                                                          |
| No bulk export for journalists                                        | **New** (J11)                                                                          |
| No UPDATE or DELETE on reports                                        | **Met**                                                                                |
| No auto-advance                                                       | **Met**                                                                                |
| **(new) No link field on any logbook**                                | **New**: the server refuses a link question in a logbook's setup, and a test proves it |

---

## Spec changes to make (for the spec's author)

1. Add the framing line to §9: the logbook is hosted for publication; the Tip List is a contact
   form to the operators.
2. **L4:** remove "plus one optional link".
3. **A3:** remove "including reports with and without a link".
4. **K5, K8, K10, X3, X3a:** remove.
5. **K12:** "illegal" does not carry over to later copies; only the blocklist blocks them. After
   erasure, the matching key is destroyed unless blocklisted.
6. **Add K13**, the blocklist (exact or domain including subdomains; keyed hashes; erased on
   arrival; logged).
7. **X2:** erasure deletes the value and its key; nothing else.
8. **J9:** tip links only, with the tip form's multiple-choice context (T7).
9. **D2:** report rejection emails a reason; removing a link or tip sends nothing; the terms say
   links and tips may be checked, withheld, removed and reported.
10. **Add E4 and E5** (the "send it as a tip" note, and browser-only pre-filling).
11. **Add T7** (the tip form's multiple-choice context).
12. **Add to §13:** no link field on any logbook.
13. **§15:** add "Whether treating tips and links as messages to the operators (not hosted
    content) satisfies the Digital Services Act, in particular Article 17, given that checked
    links are shared with vetted journalists. For legal review before launch."

---

## Proposed order of work

1. **Review session** (one). Item by item against the revised spec, with file and line,
   settling every **Check**. No code.
2. **Journalist alert list** (part of one session). J1 to J6.
3. **Reporting opens**, in parallel:
   - **Tip links** (one session): the private link field type, the link store with per-link
     keys, grouping, the blocklist, the three-outcome check with its comment, erasure, the K4
     sweep, K6 and X1 tests.
   - **Moderation and EU items** (one session): L7 refusal, L3 and L6 tests, M1 rejection
     email, M2 batch approval, M8 agreement, D1, D4, D5, P3, I5, the E2 chooser, E4 and E5.
4. **Journalist access** (one session). M5, J7 to J13.
5. **Final pass.** All three test suites; S1 and S3 against a real Caddy; then the first real
   deployment.

Roughly four to five sessions, one fewer than revision 2, with the seal untouched.

## Still open (not settled by this proposal)

- Whether the tip email is optional (I1 for tips).
- The tip form's multiple-choice questions (T7).
- The logbook's final preset lists (L4).
- Retention of tips, links and emails; the backup rotation period (T3).
- Whether a checked link group should expire and need a re-check (manual for now).
- The Digital Services Act framing (spec change 13): legal review.
