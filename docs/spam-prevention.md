# A voting site: spam and flood prevention, without email

21 October 2026. Build brief for the ReportLog rewrite. Goes with `claude/plan-d-technical-spec.md` (section 8) and `voting-questionnaires.md`.

---

## 01 T H E P R E M I S E

### Anyone can submit. Nothing they submit reaches the record unchecked.

**WHAT THIS DEFENDS AGAINST**

- Scripted bots posting straight to the submit endpoint.
- Slow, plausible fakes spread over hours, aimed at one county or state.
- Organised people filling in the form by hand.

**WHAT IT DOES NOT CLAIM**
A funded operation cannot be kept out of an anonymous form. The goal is that a flood cannot touch the public record, the public numbers, or keep the site from serving pages.

**HARD RULES THIS MUST NOT BREAK**

- Reports are append-only. Never UPDATE, never DELETE.
- Nothing is public until a moderator accepts it.
- No email, name or IP address is ever stored with a report or tip.
- One card, one question, no auto-advance.

---

## 02 A T T H E D O O R

### Cheap checks on every report and tip submission

**PROOF OF WORK**

- ALTCHA, self-hosted. The browser solves a small puzzle in the background before the send button works.
- No cookies, no third-party request.
- The server verifies the solution, refuses reused solutions, and refuses solutions older than a set number of minutes.
- Difficulty is a setting the moderator screen can raise (section 05).

**HONEYPOT FIELD**

- A field hidden from people with CSS and marked so screen readers skip it.
- Any submission with it filled is refused.

**MINIMUM TIME ON THE FORM**

- The server issues a signed start token when the form loads. A submission sent sooner than a set minimum after the token was issued is refused.
- The token carries no personal data.

**RATE LIMITS AT THE WEB SERVER**

- Caddy limits submissions per IP address per minute and per hour before anything reaches the app.
- A separate, higher limit on page loads, so reading the archive stays fast during a flood.

**IP ADDRESSES**

- Held only in memory, or as keyed hashes with a key that rotates daily.
- Deleted within a day.
- Never written to the report or tip tables, the app logs, or error tracking.
- Named in the privacy notice under legitimate interest.

**ONLY ANSWERS THAT CAN EXIST**

- Every field and value is checked against the questionnaire. Unknown fields, unknown values, and fields sent when their "only if" condition does not hold are refused.
- County must belong to the chosen state.
- Date must fall within the voting period: from the first day of early voting through a week after election day.
- Hour: for election day, within that state's polling hours. For early voting, between 5:00 and 23:00 local time.
- Tips: http or https only, at most 2,000 characters, at most three rows, a type for every link.

**HOW A REFUSAL LOOKS**

- The person sees a plain message to try again. The message does not say which check failed.
- A refusal is counted (section 05). The refused content is not stored.

---

## 03 I N T H E R E C O R D

### A flood that gets through the door still cannot shape what the public sees

**SEALED ON ARRIVAL, HIDDEN UNTIL ACCEPTED**

- Every submission that passes the door is sealed into the chain at once, so nobody can claim reports were quietly dropped.
- It stays hidden from every public view until a moderator accepts it.

**PUBLIC NUMBERS COUNT ACCEPTED REPORTS ONLY**

- Every count, map, figure, digest and alert uses accepted reports only. Test each surface.

**OPEN-FORM REPORTS AS COUNTS, NOT STORIES**

- Open-form reports appear publicly as counts by place and time, not as individual entries.
- Organization reports are labelled separately from open-form reports, which are labelled as unverified public reports.

**BURSTS ARE VISIBLE**

- Public views show when reports arrived, so a burst of identical answers looks like a burst, not a trend.

**DECLINED REPORTS ARE COUNTED PUBLICLY**

- How many reports were declined, by reason, shown on the public side.

---

## 04 T H E T R U S T E D L A N E

### Organization reports cannot be flooded from the open form

- Intake Coordinators file for their organization while signed in, with two-factor login. The organization is sealed into each report.
- Organization reports sort to the top of the moderation queue. On a flood day, open-form reports wait behind them.
- Organization intake links each have a use limit and an off switch.
- All reports from one organization can be found and handled as a set.
- Moderators also sign in with two-factor login.

---

## 05 T H E M O D E R A T O R S C R E E N

### Everything needed during a flood, without server access

There is no SSH to the server during a flood. Every control below lives in the app.

**SEE IT COMING**

- Submissions per hour for the last 24 hours, for reports and tips.
- Refusals per hour at the door, by check, without content.

**CLEAN UP FAST**

- Filter the queue by time window, state, county, and identical answer sets.
- Bulk decline what the filter shows, with one reason. Each decision is still recorded per report, with who and when.
- Batch accept for organization reports and clearly genuine sets.

**SWITCHES**

- Harder puzzle: raises the proof-of-work difficulty.
- Pause intake: the report and tip forms show "Intake is paused" and a public notice appears on the site.
- Each switch use is recorded with who and when, and shown publicly with its time.

**TIPS**

- Duplicate links are grouped, so a flood of the same link is one item in the queue.
- Blocklist by exact address or by domain. A blocklisted link is erased on arrival and never queued.
- Bulk decline of tip links by time window.

---

## 06 B E F O R E E L E C T I O N D A Y

### Rehearse it

- Run a scripted flood against a test copy: a fast burst from many addresses, and a slow stream of plausible answers aimed at one county.
- Time how long the cleanup takes with the filters and bulk decline.
- Confirm public numbers stayed at accepted reports only throughout.
- Write down what happened and fix what was slow.

If a real flood happens, publish the dates and how many reports were declined.

---

## 07 W H A T N O T T O B U I L D

### Ruled out

- Google reCAPTCHA or any third-party challenge. Sends visitor data to the US and needs consent.
- Browser fingerprinting. Personal data, needs consent.
- Blocking datacenter address ranges.
- A per-county hourly cap.
- Suspicion scoring.
- Automatic puzzle difficulty scaling.
- Single-use reporter codes. The organization lane does this job.
- Storing anything that ties a submission to a person.

---

## 08 T E S T S

### Each one fails if its rule is broken

- A submission with a filled honeypot is refused.
- A submission sent faster than the minimum time is refused.
- A submission without a valid, unused, unexpired puzzle solution is refused.
- Unknown fields, unknown values, a county outside the state, a date outside the voting period and an hour outside the allowed range are each refused.
- No IP address or request identifier reaches the report or tip tables, the app logs or error tracking.
- An unaccepted report appears in no public view, count, map, feed, export, digest or alert.
- Bulk decline writes one decision record per report.
- Pause intake stops both forms and shows the public notice.
- A blocklisted link is erased on arrival.
- Rate limits are tested against a real Caddy, not only against the app.

---

## 09 K N O W N L I M I T A T I O N S , P R E C I S E L Y

- A determined, funded operation can still submit. These measures contain a flood; they don't prevent one.
- A careful fake cannot be told from a real multiple-choice report. The organization lane and counts-not-stories carry that weight.
- The rate-limit numbers, the minimum form time and the puzzle difficulty are not set. Start conservative and tune in the rehearsal.
- The table of each state's election-day polling hours does not exist yet.
- The emergency email-confirmation switch in the technical spec (F5, F6) is left out of this brief, which covers prevention without email.
- Whether the current code seals on arrival, counts accepted reports only, and sorts the queue by organization has not been checked.
