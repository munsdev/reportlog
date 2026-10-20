# Plan D session 6 · Counties, election tips, leaving closes the desk: status

- **Branch:** `claude/plan-d-counties`, from `ccr-c9c93698-ev856l` at `b01e75c`.
- **State:** built; PR into `ccr-c9c93698-ev856l`.
- **Rulings:** 44, 45 and 46 in `docs/decisions.md`.

## What was built

- **44 · County location.** The `location` kind has a new `depth` setting. An absent `depth`
  means state only, which is how it worked before. The setting is written only as `county`, and
  `{ depth: 'state' }` is dropped on the way in, so no existing form, seal or vector changes.
  - **Code format.** `US-AZ-04013`: the state's code, then the full five-digit FIPS code. The
    roll-up to the state is a prefix (`stateOfPlace`), and FIPS is what Census and
    election-results files use. The comment in `tools/geo/build-gazetteer.js` explains why the
    code has this shape. It is one string, so the sealed object gets no new shape.
  - **Data.** The Census 2020 county list is vendored at
    `tools/geo/data/census/national_county2020.txt`. `build-gazetteer.js` derives `counties` into
    `gazetteer.json`. That gives 3,234 counties: all states, DC, PR (78), GU, VI, MP and AS. The
    builder drops the Minor Outlying Islands (one row), because no form offers them as a state.
    Countries and states come out byte-identical to before.
  - **Bundled.** The county list is bundled in the page, so it costs no request to any host.
  - **Only with US states.** County depth is accepted only when the question asks for a US state
    (`scope: 'us'`). Setup refuses it otherwise (`location-depth`), and normalizing refuses a
    county code from any question not set to county depth.
  - **The card.** One card, one question. The state and county selects (`CountyPicker`) are on
    the card from the start, and the county select is disabled until a state is chosen.
  - **"Not sure which county".** Choosing a state answers with the state, which the county select
    shows as "Not sure which county". Choosing a county answers with the county's code.
    - This is always allowed at county depth. A person who knows the state but not the county
      should not be pushed into a guess.
    - The answer is never half-made, so there is no new validation to get wrong.
    - The only thing that changes on the card is the county list, and only because the person
      chose a state.
  - **Where the picker is used.** Logbook cards (`QuestionControl`) and list forms (`ListForm`,
    using `depth` on `ListFormQuestion`).
  - **Builder and logbook files.** The builder has a "How exact" select for US questions, and
    logbook files carry `depth`.
  - **Maps and alerts.** `areaOf` rolls a county up to its state, so heat maps stay state-level.
    Thresholds are unchanged. Journalist alerts roll up the same way, in SQL.
  - **How a county is named.** `placeLabel` names a county with its state, e.g. "Maricopa County,
    Arizona", on the board, digest, desk and review card.
- **45 · Election tips template (T7).** `lists/templates/election-tips.json`, titled "Election
  tips", sits beside the general `tips.json`.
  - **Questions:**
    - Link (as in `tips.json`)
    - "Where": a location at county depth, optional, so a blank answer means not sure
    - "What day was it?": a date, optional
    - "What kind of thing is it": the elections logbook's 18 options plus "Not sure"
    - the optional transient description
  - **Counting.** Off.
  - **Desk.** The desk now shows location and date answers beside choices: places by name, dates
    in words (e.g. "November 3, 2026"), never codes. Neither kind can carry somebody's own words,
    so J10 still holds.
- **46 · Leaving the alert list closes the desk.**
  - **One path for deletes.** Every delete of `journalist_subscribers` (the stop link, a pending
    re-signup, a failed confirmation email, the lapsed-pending sweep in `alerts.ts`) goes through
    `removeSubscribers`.
  - **What it does.** In one transaction, it changes `journalist` to `user` for the account an
    approved request names. It records `revoke`/`journalist` in `role_audit`, with the journalist
    as the actor, then deletes the row; the request is removed by the cascade.
  - **The ceiling is unchanged.** `setSystemRole` is untouched, so its owner-only rule for
    `journalist` holds for every other caller. The update's WHERE clause can only turn
    `journalist` into `user`.
  - **Second line.** `deskGuard` now refuses a journalist with no approved request behind the
    role (`desk_access_ended`).
- **Footer.** A "For journalists" link to `/journalists/alerts`. It is a plain `Link`, like the
  other footer links. The route has no loader and the page calls the API only when its form is
  sent, so the link fetches nothing on a door.

## Tests added

- Unit (`packages/fields/test/counties.test.ts`):
  - every county's prefix is a known state, and every code is unique
  - every state has at least one county
  - FIPS codes and names, DC, PR and no UM
  - labels, normalizing, refusals, and today's behaviour when depth is absent
- Unit:
  - the election tips template (`apps/api/test/unit/lists.test.ts`)
  - the footer link (`apps/web/test/site-pages.test.tsx`)
- Db:
  - `counties.test.ts`: a county sealed in a logbook report through the chain; a county and a date
    kept in an election-tips list entry; the list form says county depth
  - `logbooks.test.ts`: depth refusals, and `state` not being stored
  - `maps.test.ts`: `areaOf` rolls a county up
  - `journalist-alerts.test.ts`: a county counts toward Arizona
  - `journalist-desk.test.ts`: the desk shows "Maricopa County, Arizona" and "November 3, 2026";
    decision 46 end to end (approve, accept, desk 200, stop by the emailed link, the same session
    refused, a `role_audit` row with the journalist as actor); a stray journalist role with no
    approved request is refused
- Browser (`e2e/counties.spec.ts`, chromium and phone): state, then county, on a logbook card and on
  the election tips list (sent for real; the request carries `US-AZ-04013`). The county list
  follows the state, axe passes on the card, and no request goes to another host.

## Totals

See the PR description for the final run.

## Left open

- Connecticut has its eight historical counties, as Census 2020 lists them. Its planning regions
  would be new codes, added rather than replacing the old ones (a code is never removed).
- The list editor has no control for location depth. Lists get it from a template, as they get
  their scope today.
