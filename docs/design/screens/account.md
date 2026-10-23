# REPORTLOG DESIGN

## A C C O U N T S C R E E N S

**Signing in, the second factor, your own reports and settings, journalists, organization intake, feedback and guides**

21 October 2026 · canvas boards "Sign in · email code", "Sign in · second factor", "Lock screen" · vocabulary from components.md and navigation.md

---

### 01

### W H A T E V E R Y S C R E E N H E R E K E E P S

**The rules that apply before any single page**

**PAGE FRAME**

Every page has the header from navigation.md, the eyebrow (the site name), an H1, a lede, then content in the theme's page width. Prose pages (sign in, links from emails, the declaration) use the prose measure, 65ch. Loading is a sentence with `role="status"` ("Loading…"), never a spinner alone.

**A LINK FROM AN EMAIL CHANGES NOTHING BY OPENING IT**

Mail scanners and link previews open every link. Every page reached from an email (digest stop, alert stop and change, journalist access, invitations, volunteer links) says what it will do and does it only when a button is pressed. Each has the same four states, in the same words as today: "Checking this link…", "This link could not be checked", "This link does not work any more", and the page itself.

**DOORS**

The digest stop page, the journalist alert pages and the journalist access link page are doors: they work without signing in and in front of the site password, and call only their own calls. On a door the header shows the wordmark and no Menu button (navigation.md, section 01).

**SUCCESS IS NOT TEAL**

Several of these screens show success today with `Alert tone="confirmed"` (My reports corrections, "Copy the link now" on volunteer links). Teal means a moderator confirmed something. Each becomes the `quiet` success alert with a tick and "Done" (components.md, section 09). A one-line save ("Saved.") stays a `role="status"` sentence beside the button.

**ONLY THE REPORTER CHANGES A REPORTER'S PERMISSION**

Nothing on any screen in this file other than My reports writes a reporter's permission. Coordinator corrections say so in their intro.

**EVERY ROLE HOLDER PROVES A SECOND FACTOR**

No staff screen, the journalist desk, or intake renders its content until the second factor is proved for this session. `SecondFactorGate` stays in front of all of them.

---

### 02

### S I G N I N

**`/access/sign-in` · two steps, one question each · board "Sign in · email code"**

**STEP 1, THE ADDRESS**

H1 "Sign in", lede "We email you a code. No password to remember." A raised panel holds one field, "Your email address" (`type="email"`, `autocomplete="email"`), and a primary `lg` block button "Send me a code". Under the panel, one help line: "Staff then confirm with an authenticator app or a passkey."

**STEP 2, THE CODE**

The panel's content is replaced, the page is not. A sentence: "We sent a six-digit code to **you@example.org**. It works for ten minutes." Field "The code from the email": mono, 24px, letter-spaced 0.3em, centred, `inputmode="numeric"`, `autocomplete="one-time-code"`, digits only, six at most. Primary block "Sign in"; quiet "Use a different address" goes back to step 1 with the address kept.

**ERRORS**

A refused address or code: the field is marked invalid, points at the error sentence with `aria-describedby`, and the sentence is announced (`role="alert"`). The sentence is the server's.

**WHERE IT GOES AFTER**

To `next` if the page was opened with one (the rebuild's behaviour, kept: an invitation sends people here with `next` set), else home. A person with no role is signed in after step 2. A person with a role goes to section 03 on the same page.

**THE SETUP WIZARD**

Uses the same two steps with "Become the owner" on the second button. Its frame is in the settings spec.

---

### 03

### T H E S E C O N D F A C T O R A T S I G N I N

**After the emailed code, for anyone with a role · board "Sign in · second factor"**

**PROVING IT** (factor already set up)

Eyebrow "Sign in · step 2 of 2", H1 "One more step", lede "Your account has a role on this site. Prove it is you with your second factor." In the panel:

- If the account has a passkey: primary block "Use a passkey" first.
- Field "Code from your authenticator app" (or "Or a code from your authenticator app" under a passkey button), mono and letter-spaced like the email code, hint "Six digits. If you have lost the app, type one of your recovery codes instead." The field accepts up to 24 characters so a recovery code fits; `autocapitalize="characters"`, no spell check.
- Primary block "Continue" (secondary if a passkey button is above it).
- Under the panel: "Signed in as **owner@example.org**. Not you? Start again", which signs out and returns to step 1.

**TOO MANY WRONG CODES**

The server locks the factor for a while (decision 50). The error sentence says so in the server's words and the field stays usable, so a passkey or a recovery code can still be tried. No countdown is drawn unless the server sends a time.

**SETTING IT UP FIRST** (role holder with no factor yet)

H1 "Set up a second way to sign in", lede as today ("Your account has a role on this site, so signing in takes the emailed code and then a second step… Nothing behind your role opens until you set one up."). Two choice cards, not two buttons: "An authenticator app" (note: "A six-digit code from an app on your phone") and "A passkey" (note: "Your phone's or computer's own lock, a fingerprint or face"). Next is a primary button under them. If the server has no authenticator key configured (`totpAvailable` false), only the passkey card shows, with a sentence why.

- App: a numbered list. 1, the QR code, drawn here (dark on white whatever the palette, with its quiet zone, `role="img"` with its label), and "Or type this key into the app:" with the secret in mono, grouped in fours, with a secondary "Copy the key" button. 2, the field "The six-digit code the app shows now". Primary "Turn it on".
- Passkey: field "A name for this passkey", hint "So you can tell your passkeys apart later, like "Work laptop"." Primary "Add the passkey", which opens the browser's own dialog.
- Quiet "Choose another way" returns to the two cards.

**RECOVERY CODES, SHOWN ONCE**

Straight after the first factor is set up, and after "Make new recovery codes", before anything else opens. H1 "Your recovery codes", the paragraph as today ending in bold "They are not shown again." The ten codes in a two-column grid (one column on a phone), mono, 18px, each in a `surface` box with a hairline. Under them, a row of secondary buttons: "Copy them", "Download as a text file" (made in the browser, nothing is sent), "Print them" (the print rules hide everything but the codes and the site name). Then primary `lg` "I have kept them". The codes stay on screen until that button is pressed, even when the staff screen behind them becomes available.

---

### 04

### T H E S T E P - U P D I A L O G

**"Confirm it is you", before the few actions that ask, good for five minutes**

Mounted once in the root layout, opened by any call the server answers with `step_up_required`, and by `ensureStepUp()` before a plain file link (a backup, the chain file). The rebuild's mechanism stays; this is its look.

`dialog.tsx`: title "Confirm it is you", one sentence "This needs your second factor again. It counts for five minutes.", then the same content as "Proving it" in section 03 (passkey button if any, code field). Actions right-aligned: quiet "Cancel", primary "Confirm". On success the dialog closes and the original call is made again with no second press; a `role="status"` toast "Confirmed for five minutes." Escape and Cancel close it and the action does not happen; the screen behind says nothing changed.

---

### 05

### A C C O U N T A N D S E C U R I T Y

**`/access/security` · your own factors · menu "Account and security", shown to role holders**

Eyebrow, H1 "Signing in", lede "After the emailed code, your account asks for a second factor: a code from your authenticator app or one of your passkeys. Either works wherever one is asked for." Three `SettingPanel`s (components.md, section 08), one open at a time. Every change asks for a step-up first (the server says so; the dialog asks).

**AUTHENTICATOR APP**

Closed: "Set up" or "Not set up". Open: the set-up steps from section 03; the button reads "Set up an authenticator app" or, when one exists, "Move it to another app". Quiet "Stop using it" only when another way remains.

**PASSKEYS**

Closed: "2 passkeys" or "None yet". Open: a `KeyValueList` row per passkey: its name in bold, "added 3 Oct, last used 20 Oct" in `ink-alt`, and a quiet "Remove Work laptop" button, which asks in a dialog ("Remove this passkey? You can add it again later.") before removing. Then secondary "Add a passkey". A passkey's Remove does not show when it is the last way to sign in, and a sentence says why: "This is your only way to sign in, so it cannot be removed. Add another first."

**RECOVERY CODES**

Closed: "7 recovery codes left." Open: "Making new ones stops the old ones working." and secondary "Make new recovery codes", which shows the once-only screen from section 03.

**SAYING IT WORKED**

After any change, the quiet success alert at the top of the page ("Done. Added.") and focus moves to it.

---

### 06

### I N V I T A T I O N S A N D J O I N I N G

**Looking is not accepting**

**`/access/invitation/:token`** (an organization role from an email)

H1 "Join Tarrant Voters League as coordinator", lede "owner@example.org invited **you@example.org**. The invitation lasts until 24 Oct 2026, 18:00." Two quiet panels side by side on desktop, stacked on a phone: "A coordinator can" and "A coordinator cannot", each a list. Then:

- Signed in as the invited address: "You are signed in as **you@example.org**." and primary "Accept the invitation".
- Signed out: "To accept, sign in with the invited address." and a primary link "Sign in", which returns here (`next`).
- Signed in as another address: a `deep` alert "You are signed in as **other@example.org**, but this invitation is for **you@example.org**." and secondary "Sign out and use the invited address". No accept button.

After accepting: H1 "Welcome", the success alert "You are now a coordinator of Tarrant Voters League.", and a link "Go to your account". If the role needs a second factor, the set-up from section 03 follows before any organization screen opens.

Not open (used, expired, withdrawn): H1 "This invitation is not open" and the server's sentence.

**`/organizations/join/:token`** (a volunteer link a manager made)

H1 "Join an organization". The same three signed-in states. The page names the organization and that the person joins as a coordinator who files for it. One primary button "Join". The same not-open state.

---

### 07

### M Y R E P O R T S

**`/mine` · the reports filed from the signed-in address**

H1 "My reports", lede "The reports filed from the address you signed in with." A list of rows, each a link to its thread (`aria-label` "Open RL-7K2M-4QXD"): reference in mono, logbook name, filed date, and its state as a chip: `open` "Waiting", `tag` "Public", `tag` "Counted" (counts-only logbook, decision 54), `tag` "Not published", `tag` "Withdrawn". "Declined" is a `tag`, not serious: the reporter did nothing wrong. Never teal: teal is a moderator's confirmation and appears only if that status is shown on the board.

Empty: the `EmptyState` "No reports yet", "There are no reports filed from this address. Reports you file while signed in, or confirm from the email, appear here."

---

### 08

### O N E O F M Y R E P O R T S

**`/mine/:threadId` · what it says, what you allow, and what you can still do**

Back link "All your reports" (quiet, above the eyebrow). H1 "Report RL-7K2M-4QXD" in mono. Lede: logbook and state in words. Then these sections, each a panel with its own H2, in this order:

**WHAT IT SAYS NOW**

`KeyValueList` of the questions as asked and the answers, plus "May it be published?" with "Yes, if a moderator approves it" or "No". A link "Print a signed declaration" to section 09, and "Check it has not been changed" to `/verify/:ref` when public.

**WHAT YOU ALLOW**

"You can change these at any time, and every change is kept so you can see it. Only you can change them." Three checkbox choice cards (components.md, section 06), labels and notes from `PERMISSION_WORDS` unchanged. The card shows the server's value, never the click's: while saving, "Saving…" as status beside the card, then "Saved." Switching off file publication while files are up opens the dialog "Take your files down?" first; until Yes, nothing is written. A fold-out "Every change you made" lists the history in mono.

**WHO HAS OPENED YOUR DETAILS**

`ContactAccesses`, kept: each time staff opened the contact details or an original file, or asked you for files, with the date and the reason they gave. Never who. Empty: "Nobody has opened your details."

**CORRECT IT**

Answer the logbook again as a new version; the old one is kept. Field "Why are you correcting it?" with "A moderator sees this beside the new version." A correction may take back the publication answer, never give it; the page says so beside that question.

**WITHDRAW IT** (only if not withdrawn)

"It comes off the public board and stays in the archive." Field "Why are you withdrawing it?", secondary "Withdraw it", available once the reason has text. Never a primary button and never red.

**ERASE YOUR CONTACT DETAILS**

The paragraph as today ("Your email address is destroyed. Your report is not withdrawn…"). A checkbox choice card "I understand this cannot be undone." then secondary "Erase my details". After erasing, back to `/mine`, where it no longer appears. The same act from the emailed link (`/file/erase/:token`, decision 39) is in the filing spec.

Not one of yours: H1 "Not one of your reports", the server's sentence, link back.

---

### 09

### T H E D E C L A R A T I O N

**`/mine/declaration/:threadId` · printed, never sent**

On screen: two fields, "Your full name" and "Where you will sign it" (hint "A city and country. Leave it empty to write it by hand."), and a primary "Print or save as PDF". A quiet panel says "Nothing you type here is sent anywhere." Below, the document as it will print, on a `surface` panel with no shadow: reference, logbook, filed, this version's fingerprint in mono, the answers under the questions as read, "What to do with this document", the declaration under 28 U.S.C. § 1746 in both forms, and signature lines. Print rules hide everything except the document, the header included. Type is the theme's body face at 11pt; the fingerprint wraps.

---

### 10

### E M A I L U P D A T E S

**`/notifications` and the stop link**

**THE PAGE** (signed in, anybody)

H1 "Email updates", lede as today. "How often": three radio choice cards, "No emails", "Every hour", "Once a week", each with its hint. "From which logbooks": a checkbox choice card "Every logbook" ticked by default; unticking it shows the list of logbooks as checkbox cards below it (a settings form, not a filing card, so the one-card rule does not apply). Primary "Save". The answer is a status sentence: "Saved. You will be emailed once a week." Nothing launched yet: "No logbook has been launched yet."

**`/notifications/stop/:token`** (a door)

"Stop these emails?", "Nothing has changed yet. The emails stop only when you press the button.", primary "Stop these emails". Then "These emails are stopped" and "To start them again, sign in and choose under Email updates."

---

### 11

### J O U R N A L I S T S

**Alerts, access, the desk, and the alert links**

**`/journalists/alerts`, JOINING THE ALERT LIST**

H1 "Journalist alerts". One sign-up for alerts, desk access, or both (decision 69); this is a sign-up form, not a filing card, and a section opens only when the person ticks its box. "Your name", "Your email address", then two checkbox choice cards: "Send me alerts" (ticked to begin with; opens "States you cover" as a searchable checkbox list with a "Selected: 3" count line) and "I am a journalist and want access to the journalist desk" (opens "Your request for desk access": "Your outlet", "Your role there", "Who are you?", the two optional press card fields). Before the button, a quiet panel: "Joining gives no access to anything." and links to the legal notice and privacy policy. Primary "Join the list". The answer is the same page whether or not the address was known: H1 "Check your email". The request reaches the owner only when the confirmation link's button is pressed.

**`/journalists/access` and its link page, ASKING FOR THE DESK**

Step 1: "The address you joined the alert list with", primary "Email me the link". Always H1 "Check your email" after. Step 2, the link page (a door): H1 "Ask for access to the journalist desk", lede as today. Fields: "Your outlet", "Your role there" (hint "Reporter, editor, producer."), "Links to your published work" (one per line), "Press card number (optional)", "Who issued the press card (optional)". Text only; nothing is uploaded. Primary "Send the request". End states: "Your request is with the owner", "You already have access".

**`/desk`, THE JOURNALIST DESK**

Behind the second factor and the journalist agreement gate (`AgreementGate`, kept: the agreement in full, a checkbox choice card, primary "I agree"). Then H1 "Journalist desk", lede as today, a `deep` alert "Before you use a link" with its paragraph. Two sections with `AreaTabs`-style anchors on the page, not separate routes: "Checked links" and "Sources on published reports". Each item is a raised panel: the link as selectable mono TEXT, never an anchor (the site never fetches it; copying it is a choice), a secondary "Copy the link" button, how many tips carried it as a neutral count, the moderator's comment, and the tips' answers as answer pills. Pagination under each. Empty states use `EmptyState`. Below both, "Your alerts": the alert settings form (next block) in a `SettingPanel`. A line at the foot: "Every page you open here is recorded in the access log."

**ALERT SETTINGS, ON THE DESK AND AT `/journalists/settings/:token`**

"Alerts": two radio choice cards, "Send me alerts" and "Turn alerts off for now (you stay on the list)". "States you cover": the same checkbox list. Primary "Save". Status "Your alert settings are saved." On the change page only (not the desk), a `plain` panel "The journalist desk" (decision 69): the request's state ("Your request for access is with the owner.", or access and a link to sign in), or, with none, a secondary "Ask for access to the journalist desk" that opens the request's questions and a primary "Send my request to the owner". Alerts off needs no states. Under a rule, a separate panel "Leave the list": "Removing yourself deletes your details and ends any desk access." and secondary "Remove me from the list entirely", which asks in a dialog first (decision 46). Turning alerts back on says "Alerts start again from now. Nothing you missed is sent." (decision 47).

**`/journalists/confirm/:token`, `/journalists/stop/:token`** (doors)

Confirm: "Join the alert list?" then "You are on the alert list". Stop: turns alerts off with one press ("Turn alerts off") and keeps the person on the list; the result page "Alerts are off" links to the change page for states or leaving.

---

### 12

### F I L I N G F O R A N O R G A N I Z A T I O N

**`/intake` and its pages · coordinators and managers · menu group "Your organization"**

**`/intake`, THE BATCHES**

H1 "Filing for an organization", lede as today ("Type up accounts somebody gave you on paper, by phone or in person. Nothing is filed until you have checked the whole batch and said so."). With two or more organizations, "Which organization are these accounts for?" as radio choice cards, asked once per batch. Primary "Start a batch". Below, the person's batches as rows: name or date, organization, "4 accounts · 1 not ready" in mono, state chip (`open` "Open", `tag` "Filed"). Empty: `EmptyState` "You have not started a batch yet."

**`/intake/:id`, ONE BATCH**

Title and organization, count line ("6 accounts · 5 ready · 1 needs an answer"), secondary "Add an account". Each account is a row: its logbook, "how it was collected", the day, the coordinator's own reference in mono, and what it still needs in `ink-alt` ("Needs: Where"), with Edit and Remove (quiet). Files being prepared show "Preparing 2 files" as status.

"Before filing": a raised panel listing what will happen in numbers ("5 accounts will be filed. 1 stays in the batch.") and what cannot be undone, a checkbox choice card with the attestation statement, and primary "File this batch", which opens the dialog "File this batch" with the same numbers. Refused: alert "Nothing was filed" with the server's sentence. Accounts not ready stay; nothing is thrown away.

**THE ACCOUNT DIALOG**

One account at a time, in a dialog that fills the phone screen and is 720px on desktop. "Which logbook" (select), then that logbook's questions as fields (staff form, so all on one scroll, not cards), "How it was collected" (select), "The day it was collected" (date, hint "If you know it."), "Your own reference for it", the publication question in the coordinators' wording, and the file picker (`file-drop.tsx`). Saving never refuses for something missing: primary "Save to the batch", quiet "Cancel".

**`/intake/reports/:threadId`, CORRECTING A FILED ACCOUNT**

Intro: "A correction is a new version, attested by you as the batch was. The one before it is kept. Nothing here gives or takes back the reporter's permissions." The account's fields, "Why are you correcting it?" (hint "A moderator sees this beside the new version."), and where keeping something out is chosen, the `deep` alert "Keeping it out cannot be undone". Primary "File the correction".

**`/intake/links`, VOLUNTEER LINKS** (managers)

H1 "Volunteer links", lede as today. Form: "How many people may use it" (number), primary "Make a link". The new link shows once in a `deep` panel titled "Copy the link now" (not teal), the link in mono, secondary "Copy", and "Only this screen shows it. We keep a fingerprint of it, not the link." Existing links as rows: made on, used 3 of 10, on or off, and quiet "Switch it off" (a link switched off stays off; the button says so in a dialog). Not a manager: "You do not manage an organization, so there are no links for you to make."

---

### 13

### F E E D B A C K A N D T E S T E R S

**`/feedback`, `/feedback/testers`**

**REPORT A BUG ON THIS PAGE**

The menu item (navigation.md, section 02) opens `/feedback?from=<route id>`, the router's name for the screen, never its address (an address can carry a token). The form shows "About: Moderation queue" as a `tag` chip with quiet "Not about this page" to clear it.

**THE TESTER'S PAGE**

H1 "Feedback", lede as today. "File something new" panel: "What kind of feedback is it?" and "How much does it get in your way?" as radio choice cards in two columns on desktop, "A title" (hint as today), "What happened?", "A report's reference, if it is about one (optional)" in mono. Primary "File it". Below, every tester's issues, newest first, so a duplicate is seen first: rows with "#42" in mono, kind, how much, title, status chip (`open` for open, `tag` for the rest). Opening one shows the replies (the administrator's status changes and notes) and comments, then "Add a comment" (hint "Comments cannot be changed afterwards."). Authors are masked handles.

**THE ADMINISTRATOR'S QUEUE**

Same title, lede "Every issue testers have filed. Anything still open is in the weekly email until somebody moves it." A status filter as pressed buttons with counts (the moderation queue pattern), the count line, rows, and in each issue "Move it to" select plus a required note, primary "Move it", because the note is the reply the tester is emailed.

**`/feedback/testers`**

H1 "Testers", lede as today, then the paragraph about masked handles. "Make somebody a tester": email field and secondary "Give the flag". Rows: address, since when, quiet "Take the flag away". Empty: "Nobody has the flag."

---

### 14

### G U I D E S

**`/docs`, `/docs/first-logbook`, `/docs/checking` · static, no requests**

Prose pages in the theme's look. `/docs` is three raised panels linking the guides. Each guide: H1, lede, then `ProseSection`s with numbered eyebrows ("1 · Make the draft") and the "Why" fold-outs as `details` with a quiet panel inside. A "Contents" list at the top links the sections; on desktop it sits in a left column of 14rem that does not scroll with the page (the old sticky contents strip stays dropped, decision 28). Code and reference values in mono. Print rules print the guide only.

---

### 15

### K N O W N L I M I T A T I O N S , P R E C I S E L Y

- Sessions are not listed anywhere. Decision 50 sets staff sessions to 12 hours, but there is no call that lists or ends a person's sessions, so section 05 has no sessions panel. If one is wanted, it needs an API first.
- Copy, download and print for recovery codes are new. The codes never leave the browser, but printing relies on the browser's print dialog, which some browsers send to a cloud printer.
- The lockout wording depends on what the server sends. If it does not send when the lock ends, the page cannot say.
- The signed-in-as-the-wrong-address state on invitations is drawn from what the page knows (the signed-in email and the invited one); whether the server already refuses that case with its own sentence was not traced.
- The journalist desk keeps links as text by design. "Copy the link" is new and uses the clipboard API, which needs a secure context and fails silently in some embedded browsers; the text stays selectable as the fallback.
- The account dialog in intake shows a logbook's questions as one scrolling form, not cards. The one-card rule binds what reporters see; a coordinator typing up paper is staff. This is a reading of the rule, not a decision recorded anywhere.
- None of these screens is drawn on the canvas except sign in, the second factor and the lock screen. Every other layout here is described, not mocked up.
