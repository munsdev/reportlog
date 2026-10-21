# Plan D session 8 · ElectionLog's forms: status

- **Branch:** `claude/electionlog-forms`, from `ccr-c9c93698-ev856l` at `eb5fca2`.
- **State:** built; PR into `ccr-c9c93698-ev856l`.
- **Spec:** `docs/electionlog-questionnaires.md` (the owner's, 21 October 2026).
- **Rulings:** 48 (rewording after launch) and 49 (the strict reading) recorded in
  `docs/decisions.md`. Ruling 42 holds: every engine change is a general capability, and nothing
  reads "is this ElectionLog".

## The presets

| Preset                                                       | What it is                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logbook starting point `electionlog` ("Log how voting went") | The eight cards of §03, eleven questions, every key, code, label and "only if" as written. No file question.                                                                                                              |
| List template `electionlog-tips` ("ElectionLog tips")        | §04: one card, three fixed rows of a link and what kind of link it is, row 1 required. Strict. Asks no email and no comment.                                                                                              |
| Site starting point `electionlog` ("ElectionLog")            | Public archive on, uploads off, intake open; makes the logbook (a draft) and the list at `/list/tips`, named "Send a link" (hidden until listed); the entry card's question; the send card's line; the front page's text. |

Setting up test3 from the admin screens: apply "ElectionLog" in Settings → Starting points (or
the setup wizard), launch the logbook, and set the list to Listed. Launching and listing are the
operator's own steps, as for every starting point. `apps/api/test/unit/electionlog-spec.test.ts`
reads the owner's document itself and checks every code and label in the presets against its
tables, so the two cannot drift apart unnoticed.

## The engine, built generally

All in `packages/fields` (pure, browser-safe), with the server, the cards and lists.

1. **Option codes.** An option is a plain string (its own code and label, exactly as before) or
   `{ code, label }`: the code is stored and sealed, the label shown. A list is all one or all
   the other. A form with string options serializes and seals byte-identically to before; the
   legacy seal vectors are green and no fixture was touched. Conditions name codes.
2. **Rewording after launch (ruling 48).** Migration `20261021111006_reword_after_launch.sql`
   replaces the core migration's `logbook_fields_guard` (the old file is untouched). A launched
   question may change its label and help, and in its settings only the words:
   `form_settings_without_wording` takes out option labels (in `options` and in every option
   set), `help_when` texts and `card_question`. Key, kind, order, required, `shown_when`, every
   code and every condition still refuse. `withoutWording` in `packages/fields` is the same rule;
   a database test feeds both every question's settings. The module refuses first
   (`launched-codes`), and each rewording records a new form version.
   - **A report seals the version it was asked.** The public form now carries its version hash
     (`form`), and the page sends it back. When it differs from today's only in wording, that
     version is sealed (`formAsked` in `filing/filing.ts`); otherwise today's, as before.
   - The builder has a "Reword" form for a launched logbook (labels, help, each coded choice's
     words, with the code shown and not editable). Its edit form for a draft keeps every
     setting it does not edit, and writes a coded choice as `code | words`.
3. **Several questions on one card.** A question with `same_card` is shown on the card of the
   question before it; the first carries `card_question`, the card's own question. **Why a card
   of questions, not a compound kind** (comment in `packages/fields/src/cards.ts`): everything
   downstream works one key at a time (the seal, conditions, maps, alerts, filters, counts,
   exports, the desk), and a kind whose one answer was several keys would teach all of them a
   second shape. A part may not depend on another part of its own card (`card-shape`).
   - **Card 3.** `state` is a `location` with `code: 'postal'` (seals `AZ`; 50 states, DC, PR,
     GU, VI, AS, MP; the gazetteer PD6 bundled). `county` is a `location` at county depth with
     `code: 'fips'` and `within: 'state'` (seals `04013`). A county outside the chosen state, or
     with no state, is refused on the server. The county select is inactive until a state is
     chosen, and changing the state clears it (`withChange` in `walk.ts`).
   - **Card 4.** `date` always; `hour` a `number` with `integer`, 0 to 23 and `picker: 'hour'`
     (a select of the 24 hours), only in person; `hour_approx` a yes/no with `checkbox`: ticked
     seals `true`, unticked seals nothing, and `false` is refused.
   - Maps and journalist alerts read a postal state as `US-XX`, so they keep counting by state.
4. **Conditional option sets and help.** `option_sets` (the first set whose `when` holds is
   offered; none holding means not asked) under one key, so `other` and `wrong_ballot` are one
   code across the lists, and a shared code may carry its own label per list (`arrived_late`).
   `help_when` gives card 3 its two helps. Answers are shown by their label everywhere they are
   read (`describeAnswer`): the review card, the board, the moderation screens, the digest, the
   desk, My reports.
5. **Strict conditions (ruling 49).** `strictProblems` refuses an unknown key, an answer whose
   "only if" does not hold (or whose sets offer nothing), and a value not in its conditional
   list. Applied on every sealing path: filing, a reporter's correction, coordinator intake and
   its correction. A list stays lenient unless it opts in (`lists.strict`, migration
   `20261021111719_strict_lists_and_link_types.sql`); the tip list does.
6. **Tip link rows.** A list's link question may carry `link_types` (codes and labels) and
   `fixed_rows`: each row is `{ url, type }`, both or neither. Refused: a type without a link, a
   link without a type, a type not on the list, more than three rows, a row with anything else,
   row 1 empty, and (strict) any other field. Links are capped at 2,000 characters (was 2,048).
   - **The kind of link is kept on the link's own row** (`links.link_type`), not in the entry's
     answers: it describes that one link, it goes when the link is erased, and the desk shows it
     beside the link ("Kind of link: Livestream", J9), as does the moderators' review.
   - **Every Plan D link rule still holds.** The value is encrypted under its own key, grouped by
     keyed matching, checked by the blocklist on arrival (K-rules); journalists see only checked
     groups (M5). Nothing about storage, matching or erasure changed.
   - **A list with no email works.** Checked by test: the entry is kept with no email, no erasure
     token (nothing personal to erase), links stored and reviewable, the desk shows them once
     checked. The T-rules that still apply hold: no upload (T2), its own tables (T1), never
     counted (T4: counting off), links erased with the entry (T3). The tip list asks nothing a
     timer would erase, so its entry has no erasable half.
   - **K2's wording** is now the owner's (§04), everywhere a link is asked.
7. **Entry card, send card, thank you.** `/submit` (PD4a's card) reads its question from a new
   copy slot, `submit_question` ("What are you reporting?" until written), and names the tip list
   by its own title, so the ElectionLog setup asks "What do you want to do?", answered "Log how
   voting went" or "Send a link". The send card shows a new optional slot, `send_note`, beside
   Send. The page after sending, and the confirmation page, say "Thank you. Have a link, photo or
   video? Send it as a tip." with the link to `/list/tips`. Nothing sent to the server connects
   a tip to a report.
8. **Docs.** `docs/plan-d-spec.md` E2 (and K2) changed; `docs/plan-d.md` gains the open
   limitations.

## Known gaps and things to decide

- **The send card's line is not yet true.** "This report can't be changed or withdrawn after you
  send it" is the owner's wording, set by the starting point in the operator's `send_note` slot
  (agreed with the managing session). Today a reporter can still sign in and correct or withdraw
  from My reports. The anonymous-filing redesign is expected to remove that; until then the line
  overstates. Clearing the slot removes it.
- **Polling hours.** The hour is checked as 0 to 23 only (§05: the table does not exist).
- **Identifying answers** (`poll_worker`, `observer`, `assisting`, `provisional`) are kept as the
  spec says; whether to keep them is open.
- **The tip list keeps its intro card** ("Before you start"), which every list form has. The
  questionnaires describe one card; the intro says nothing is published and asks nothing.
- **The builder cannot yet author** option sets, conditional help, cards, or postal/FIPS places
  from scratch; they arrive from a logbook file or a starting point, and the builder keeps and
  rewords them. Writing them by hand would need a builder of its own.
- **A county by FIPS on a heat map.** A map counts the state question; marking the `fips` county
  question as the map's place counts nothing (maps are state-level anyway, decision 44).

## Tests

TOTALS_PLACEHOLDER

## Outside my folders (kept minimal)

`maps/aggregate.ts` and `journalists/alerts.ts` (a postal state read as `US-XX`, in SQL),
`journalists/desk.ts` and `links/reads.ts` (the kind of link), `links/store.ts` (writes it),
`lists/*` (strict, rows, coded options), `site/templates.ts` and `site/copy.ts` (the `list` key,
two slots), `filing/*` (strict reading, the version shown), `logbooks/*` (settings, rewording),
contracts (`logbooks`, `lists`, `filing`, `site`, `templates`, `links`), web form, builder,
lists, intake and My reports, the generated types, and the tests that asserted the old
behaviour (rewording refused, four list templates, thirteen slots, the old K2 and tip wording).
