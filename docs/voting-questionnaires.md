# HOW VOTING WENT

## L O G B O O K A N D T I P L I S T Q U E S T I O N N A I R E S

**Every card, field and allowed value for the one logbook and the tip list**

21 October 2026 · form text and field spec, not legal advice

---

### 01

**How the fields work**

**STORED VALUES**

Each answer is stored and sealed as a code. The label is what the person sees. Labels can be reworded later without touching sealed records; codes cannot change.

**OPTIONAL FIELDS**

A field marked "only if" is left out of the record when its condition does not hold. It is never written as null. An absent key and a null key hash differently.

**SERVER CHECKS**

The server refuses any field not listed here, any value not in its list, and any field sent when its "only if" does not hold. No free text, no files, no links in the logbook.

**CARDS**

One card asks one question. Where an answer changes what is asked, the change happens on the next card. No auto-advance on selection.

---

### 02

**Entry card**

**QUESTION**

> What do you want to do?
>
> Log how voting went · Send a link

"Log how voting went" opens the logbook. "Send a link" opens the tip list.

---

### 03

**Logbook: cards and fields**

One logbook for every voter in the US or abroad, every voting method, good and bad.

**CARD 1 · HOW IT WENT** · field `outcome` · one choice

> How did it go?

| Code      | Label                |
| --------- | -------------------- |
| `fine`    | It went fine         |
| `problem` | Something went wrong |

**CARD 2 · METHOD** · field `method` · one choice

> How did you vote, or try to vote?

| Code           | Label                                |
| -------------- | ------------------------------------ |
| `election_day` | In person on election day            |
| `early`        | In person before election day        |
| `mail`         | By mail                              |
| `overseas`     | From overseas or as a military voter |

**CARD 3 · WHERE** · fields `state`, `county`

> Which state and county?

Both dropdowns are visible on the card. County is inactive until a state is picked. Changing the state clears the county.

_Help, in person:_ The county where the polling place was.
_Help, mail and overseas:_ The county where you are registered.

| Field    | Stored as                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`  | Two-letter postal code: the 50 states, DC, PR, GU, VI, AS, MP                                                                                                                                                                      |
| `county` | Five-digit federal county code (FIPS), from the Census Bureau county list. Includes Louisiana parishes, Alaska boroughs and census areas, Virginia independent cities, and territory equivalents. Must belong to the chosen state. |

**CARD 4 · WHEN** · fields `date`, `hour`, `hour_approx`

> When was it?

Date picker. For in person, an hour picker in local time at the polling place and an "Approximate" checkbox. For mail and overseas, date only; the clock is not shown.

| Field         | Condition                                     | Stored as                                              |
| ------------- | --------------------------------------------- | ------------------------------------------------------ |
| `date`        | always                                        | YYYY-MM-DD                                             |
| `hour`        | only if `method` is `election_day` or `early` | 0 to 23, local time, within that state's polling hours |
| `hour_approx` | only if the box is ticked                     | `true`                                                 |

**CARD 5 · YOU WERE** · field `role` · one choice · only if in person

> Were you there as

| Code          | Label                |
| ------------- | -------------------- |
| `voter`       | A voter              |
| `poll_worker` | A poll worker        |
| `observer`    | An observer          |
| `assisting`   | Helping someone vote |

**CARD 6 · WAIT** · field `wait` · one choice · only if in person, good and bad

> How long did you wait?

| Code       | Label                |
| ---------- | -------------------- |
| `under_30` | Under 30 minutes     |
| `30_60`    | 30 minutes to 1 hour |
| `60_120`   | 1 to 2 hours         |
| `over_120` | More than 2 hours    |
| `left`     | I left before voting |
| `not_sure` | Not sure             |

If `outcome` is `fine`, the next card is the send card.

**CARD 7 · WHAT WENT WRONG** · field `problems` · one or more · only if `outcome` is `problem`

> What went wrong? Tick everything that applies.

The list shown depends on `method`.

_In person (`election_day`, `early`)_

| Code               | Label                                              |
| ------------------ | -------------------------------------------------- |
| `polls_closed`     | Polling place closed when it should have been open |
| `place_moved`      | Polling place moved, or not where it was listed    |
| `signs`            | Signs missing or wrong                             |
| `access`           | Hard to get in for someone with a disability       |
| `not_on_list`      | Not on the voter list                              |
| `id_problem`       | Problem with ID                                    |
| `told_provisional` | Told to vote a provisional ballot                  |
| `come_back`        | Told to come back later                            |
| `turned_away`      | Turned away without voting                         |
| `no_language_help` | No help available in my language                   |
| `machine_down`     | Voting machine not working                         |
| `scanner_down`     | Ballot scanner not working                         |
| `checkin_down`     | Check-in system down                               |
| `out_of_ballots`   | Ran out of ballots                                 |
| `wrong_ballot`     | Wrong ballot, or a ballot with errors              |
| `campaigning`      | Campaigning near the entrance                      |
| `recording`        | People recording or photographing voters           |
| `police`           | Police, security or federal agents present         |
| `intimidation`     | I felt intimidated or harassed                     |
| `other`            | Something not on this list                         |

_By mail (`mail`)_

| Code            | Label                                                     |
| --------------- | --------------------------------------------------------- |
| `not_arrived`   | Ballot never arrived                                      |
| `arrived_late`  | Ballot arrived late                                       |
| `wrong_ballot`  | Wrong ballot, or a ballot with errors                     |
| `missing_parts` | Envelope or pages missing                                 |
| `drop_box`      | Drop box missing, full or closed                          |
| `return_late`   | Couldn't send it back in time                             |
| `rejected`      | Told my ballot was rejected, or my signature didn't match |
| `count_unknown` | Couldn't find out whether it was counted                  |
| `other`         | Something not on this list                                |

_From overseas or military (`overseas`)_

| Code              | Label                                      |
| ----------------- | ------------------------------------------ |
| `request_problem` | Problem registering or requesting a ballot |
| `not_arrived`     | Ballot never arrived                       |
| `arrived_late`    | Ballot arrived too late                    |
| `portal_down`     | Email or online portal didn't work         |
| `no_response`     | Election office didn't respond             |
| `return_late`     | Couldn't send it back in time              |
| `fwab`            | Had to use the federal write-in ballot     |
| `consulate`       | Embassy or consulate couldn't help         |
| `count_unknown`   | Couldn't find out whether it was counted   |
| `other`           | Something not on this list                 |

**CARD 8 · DID YOU VOTE** · field `voted` · one choice · only if `outcome` is `problem`

> Did you vote?

| Code          | Label                     | Condition      |
| ------------- | ------------------------- | -------------- |
| `yes`         | Yes                       |                |
| `provisional` | Yes, a provisional ballot | in person only |
| `no`          | No                        |                |
| `not_yet`     | Not yet                   |                |
| `prefer_not`  | I'd rather not say        |                |

**SEND CARD**

> This report can't be changed or withdrawn after you send it.
>
> [Send report]

**THANK YOU PAGE**

> Thank you. Have a link, photo or video? Send it as a tip.

The tip link opens the tip list. The server never connects a tip to a report.

---

### 04

**Tip list: fields**

**CARD**

One card. Three link rows, always shown; nothing is added or removed. Row 1 is required, rows 2 and 3 are optional.

**TEXT ABOVE THE ROWS**

> Links you send here are never published. A moderator checks each one, and links that pass may be shared with vetted journalists. Don't link to your own account if you want to stay anonymous.

**EACH ROW**

| Field  | Stored as                                                                                 |
| ------ | ----------------------------------------------------------------------------------------- |
| `url`  | Starts with `http://` or `https://`, at most 2,000 characters. The server never opens it. |
| `type` | One choice from the list below, required once a link is filled in                         |

| Code         | Label                              |
| ------------ | ---------------------------------- |
| `video`      | Video                              |
| `photo`      | Photo or image                     |
| `post`       | Social media post                  |
| `article`    | News article                       |
| `official`   | Official notice or government page |
| `document`   | Document or PDF                    |
| `livestream` | Livestream                         |
| `other`      | Something else                     |

**SERVER CHECKS**

Refused: a type without a link, a link without a type, more than three rows, any other field.

---

### 05

**K N O W N L I M I T A T I O N S , P R E C I S E L Y**

- Spec item E2 in the Plan D technical spec says "I was at a polling place". It has to change to the entry card in section 02.
- `poll_worker`, `observer`, `assisting` and `provisional` are the answers most likely to point at one person in a small county. They are kept; whether to keep them is not decided.
- The hour check needs each state's polling hours in the server. That table does not exist yet.
- Launch freezes the codes. Labels can change after launch; codes cannot.
