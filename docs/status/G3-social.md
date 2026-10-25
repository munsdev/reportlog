# G3 · Social media links: status

- **Branch:** `claude/vibrant-cray-ji1tfs`, from `main` at `e22cbd7`.
- **State:** built and pushed; not merged. Test results under "Verified" below.
- **Asked for (25 October 2026):** a way to put the site's social media links on it, added in the
  admin panel, at least Facebook, Instagram, Threads, Bluesky, TikTok and YouTube, each switched
  on or off on its own, with icons, in logical places; and a look at whether the staff panel's
  grouping should change.

## What was built

One migration, `20261025002702_social_accounts.sql` (a nullable `site_settings.social_links`
jsonb list, like `home_sections`); types regenerated. Presentation only, never sealed.

- **Contract** (`packages/contracts/src/site.ts`, "the site's accounts elsewhere"):
  `SOCIAL_PLATFORMS` (the six asked for, then Mastodon, X, Telegram, WhatsApp), each with its
  hosts, what a handle stands for and an example (`SOCIAL_RULES`). `socialAddress` turns what was
  typed into a link or a refusal in words; `resolveSocialLinks` makes a stored list whole (every
  platform once, in order; a new one starts off); `shownSocialLinks` is what a visitor sees.
  `Site.social_links` (only what is on) and `SiteEditor.social_links` (everything);
  `PUT /api/admin/site/social` (`setSocialLinks`).
- **Server** (`apps/api/src/site/social.ts`, `routes.ts`): admin-only like every site setting.
  Refuses an unknown platform, one named twice, an address `socialAddress` refuses, and one
  switched on with no address. A platform left out of the body keeps what it had.
- **Screen** `/settings/social`, "Social media", in the Site area after Wording, and a panel on
  the `/settings` overview.
- **On the public site:** marks in the footer of every page (`components/ui/social-links.tsx`),
  and a new front-page section `social`, "Follow us elsewhere", which the front page's editor can
  hide and move. `resolveHomeSections` appends it, shown, on every site; it draws nothing until an
  account is switched on.
- **Icons** (`components/ui/social-icon.tsx`): Simple Icons 16.35.0 paths (CC0-1.0), bundled, in
  the text colour. No request leaves the origin; the browser test checks it.

Links carry `rel="me noopener noreferrer"`: no referrer reaches the platform, and Mastodon can
verify the account.

## Grouping in the staff panel

Considered, and left as decision 71 has it apart from the new page. Social media sits in **Site**,
beside the name and wording: it is what the public pages say about the site, not content it
collects, so not **Content**. Two moves were weighed and not made, for the owner to decide:

- **Front page** (`/logbooks/front-page`) is in Content. It edits the front page's buttons, which
  choose logbooks, so Content is defensible; but the headline and sections are edited on the
  front page itself, and a person looking for "what the front page says" may look in Site first.
- **Development notice** is in Site; it is about the software's state, and could sit in Logs and
  system beside Updates.

## Not done

- No Menu-panel row of marks: the footer is under every page, the menu panel stays links to
  this site.
- No per-platform ordering: `resolveSocialLinks` always returns `SOCIAL_PLATFORMS`' order. The
  column is already a list, so letting an administrator reorder would change that function and
  the screen, not the database.

## Verified

- `pnpm check`: green.
- `pnpm test:db`: 1447 of 1448 on the full run; the one failure was this migration's first
  name (`*_social_links.sql` is read as a link-list table by `archive.test.ts`). Renamed;
  `archive.test.ts` and `site.test.ts` then pass.
- Browser suite, full run (25 October): 1160 passed, 9 skipped, 21 failed. **None is this
  work's**: the same specs on `main` (`e22cbd7`) fail the same way — `navigation.spec.ts:243`
  for every role (the public Main menu shows "My reports"), `two-factor.spec.ts:131`, and
  `voting-log.spec.ts:98` and `:203`. The 21st, `site-ops.spec.ts:145` (44px), measured the
  development notice's badge (38px), which `site-pages.spec.ts` turns on for a while in another
  worker; it passes on its own. The new test in `site-pages.spec.ts` passes.
- **Trap met on the way:** a browser run killed part-way leaves its API on :3000 and its preview
  server behind, and the next run reuses them, against a database that no longer exists. Every
  signed-in test then fails ("Not for this account"). Make sure nothing is listening on :3000
  before a run.
