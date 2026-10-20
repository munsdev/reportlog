# Plan D session 3 · Tip links: status

- **Branch:** `claude/plan-d-links`, from `ccr-c9c93698-ev856l`, with PD2 (alerts) merged in.
- **State:** built; PR into `ccr-c9c93698-ev856l`.

## What was built

- **The link store is replaced, not added to** (review item 6). Migration
  `20261020172901_links.sql` drops `list_entry_links` (plaintext `url_raw`, unkeyed `url_key`) and
  `link_index` (durable, never erased), and takes each link out of the entries' answers. **Nothing
  is carried across:** plain values cannot be encrypted from SQL, and no site has taken real tips.
- **`apps/api/src/links/`**, one module for every link. Each value is AES-256-GCM under a key of
  its own (K9), stored beside it wrapped. One random secret in `link_secrets`, wrapped by a key
  derived from `CONTACT_KEY`, is what every wrapping key, matching key and blocklist hash comes
  from. So a `CONTACT_KEY` rotation re-wraps one row (`rewrapLinkSecret`, called from
  `filing/rotateContactKey.ts`) and no keyed hash has to be recomputed. The blocklist never holds
  an address, so its hashes could not be recomputed anyway.
- **Matching key and grouping (K11, K12).** The matching key is an HMAC of the normalized
  address. Every tip keeps its own row, and the queue shows one entry per group with its copy
  count. "Checked" and "withheld" carry over to later copies. "Illegal" erases every copy, nulls
  the group's matching key and does not carry over: a later copy starts a new, unchecked group.
- **Normalization, settled (K11):** `lists/urls.ts` as it was (lower-case scheme and host,
  punycode, trailing dot gone, trackers stripped, the remaining query sorted, a fragment kept only
  when it names a post), plus **a trailing slash removed** (not the root's). URL already drops a
  default port. Stripping trackers is a choice beyond the plan's "query kept": `fbclid` and the
  like say who shared a link. Shorteners are still refused at the door, so a shortener address can
  never arrive, and blocking one is refused as "not an address this site would take".
- **The check (M3, M6):** checked, withheld or illegal, with an append-only history
  (`link_checks`). Illegal needs a reason category, can blocklist the exact address or the whole
  domain in the same step, deletes every copy's value and key, and writes `link_erasures` (who,
  when, category, how many: X2, X4). **X4 is a table of its own, not a new kind in
  `contact_access_log`:** that log's `kind` CHECK is moderation's, and two sessions redefining one
  constraint at once is how one loses the other's kinds.
- **The comment for journalists (M4):** one per group, 500 characters at most, the warning line
  above the box, every edit in `link_comments` (append-only). An empty one clears it.
- **The blocklist (K13):** by exact address or by domain, including subdomains (the host and
  each parent domain are hashed on arrival, never the bare top-level one). Stored as keyed hashes
  in `link_blocklist`. A match is never written. Every addition and removal goes in
  `link_block_log` (append-only) with who, when and a category. Copies that arrived before an
  entry was added stay until their group is marked illegal.
- **Erasure with the entry (T3):** the timer sweep and the emailed erasure link both delete an
  entry's links, value and key, in the same transaction. A group left with no copies, no check
  and no comment goes too. The comments and emails that said "the links stay" now say they go.
- **Reads (K7):** `/api/link-checks/*`, one scope guarded `roleGuard(['moderator', 'admin'])`
  (the owner satisfies admin). **For the journalist desk (session 5):** `checkedLinks(db, keys)`
  in `links/reads.ts` returns checked groups only, with the URL, copy count, comment and entry ids.
  Unchecked, withheld and illegal groups never come out of it.
- **Screens:** `/lists/links` (staff nav "Link checks"): the queue by outcome, the check with its
  reason and block, the comment box, the history, the blocklist, and the hotline procedure with
  links to the two hotlines (X5). The list review page shows each link's check. Links are text,
  never anchors (K6).
- **K1, K2:** http and https only, 2048 characters at most (`lists/urls.ts`, now with its own
  test). The spec's wording sits directly above every link field (`LINK_FIELD_WORDING` in the
  contract, rendered by the form's link field).
- **Ruling 40:** a list entry's email is encrypted under its own key (`email_enc`, `email_key`)
  with a keyed digest (`email_hmac`) for the administrators' subject access search, which now
  finds an address by its digest and never decrypts one. `ip_hash`, `list_salts`, `salt.ts`,
  `LIST_SALT_DAYS` and the "one address sending many" review cluster are gone. Without
  `CONTACT_KEY` a list refuses an entry carrying an email or a link (503, with a sentence).
- **Ruling 42:** maps now count a list only if its "Publish the counts" switch is on, checked
  when the map is saved and again at render time. The counts route, board figures and daily
  snapshot already read it. The tips template ticks no question as countable; nothing
  hard-codes tips.
- **Boundary rule** `links-never-reach-the-chain` (review item 13). The unused `linkCounts` is
  removed.

## Tests

- `test/db/links.test.ts` (16): own key per copy, keyed matching key, rotation of the secret,
  carry-over, illegal (reason, erasure, log, no carry-over), exact and domain blocks (subdomains,
  nothing written, a sibling domain untouched, removal logged, no address stored), comment
  history and cap, the desk read sees checked only, **K7 for every role** (owner, admin,
  moderator: 200; access manager, user: 403; signed out: 401, on every route).
- `test/db/links-k4.test.ts` (5): **K4**, walks every registered public GET from Fastify's own
  route list, as a stranger and as somebody signed in with no role, plus the archive export and
  the daily counts, against a listed tips list with published counts, approved entries, a checked
  group and a comment naming the canary host. It also proves it looks: a canary in the list's title is found.
- `test/unit/links.test.ts`: **K6 and X1** across `apps/api/src`: only `jobs/doctor.ts` makes a
  request, and `links/` and `lists/` contain no network code. Domain rules, categories, the K2
  wording.
- **I4** (review item 12): the four new append-only tables are in the floor list and planted;
  the catalogue sweep finds them, with no `KNOWN_GAPS` entry. `/api/link-checks` is a staff
  prefix in I2.
- `apps/web/e2e/links.spec.ts`: K2 wording on the visitor's form, links as text with no anchor,
  no request to another host, check, comment, history, illegal with a domain block, and a later
  copy from a subdomain never appearing.
- Changed to fit: the lists, lists-routes, lists-search, archive, ops, maps, board, contact-key
  rotation and staff-nav tests (links out of answers, encrypted email, no salts, ruling 42).

## Suites

| Suite          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`   | passes (api unit 406 passed, 19 skipped; web 566 and the rest).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm test:db` | 78 files, 1139 passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Browser suite  | 868 tests: 830 passed, 5 skipped, 32 did not run, 1 failed: `filing/permissions.spec.ts:123` [phone], "Response has been disposed" in its own route intercept. **Also fails on the base branch** (reproduced there 1 run in 3, alone and beside `lists.spec.ts`), and passes on this branch alone (twice). Not this branch's. `links.spec.ts`, `lists.spec.ts` and the permissions spec re-run together: 15 passed, 1 failed (the same flake). **The whole suite was not re-run.** |

After the full `test:db` run, `rewrapLinkSecret` was added to the rotation. The rotation, links
and lists files were re-run alone (72 passed). The whole suite was not re-run after that.

## Outside my folders (kept minimal)

`.dependency-cruiser.cjs` (one rule), `apps/api/src/app.ts` (the key loader and one
registration), `maps/aggregate.ts` and `maps/manage.ts` (ruling 42), `anchor/archive.ts` (the
list of list tables), `config.ts`, `jobs/lists-sweep.ts`, `filing/rotateContactKey.ts` (the link
secret moves with a rotation), `features/staff-nav/entries.ts` (one entry), `test/db/invariants.test.ts`
(prefix, floor, planted rows), `test/db/identity-helpers.ts` (`harness` takes optional config),
`.env.example`, `deploy/README.md`, `docs/lists.md`, `docs/decisions.md` (rows 40 and 42).

## Not done, or open

- **Editorial "Sources" links** on public board pages (review K4 hazard 1, item 2) need an owner
  ruling. The K4 sweep plants only tip links, so it neither allows nor forbids them.
- **A logged path for a moderator to open a tip's email** (M7) does not exist: nothing decrypts
  one outside the filing request. The new-entry email to an operator still carries the sender's
  address, as before, sent at filing time.
- **One access log or two:** link erasures are in `link_erasures`, not `contact_access_log` (see
  X4 above). If the owner wants them in one log, a later migration can add the kind there.
- Retention of checked and withheld groups (their matching key and comment outlive their copies,
  so the check carries over) and the backup rotation period are still open (plan "Still open").
