/**
 * How this deployment looks and what it says about itself: the palette and
 * theme, its name, the words on its own pages, and its legal notices.
 *
 * NEVER SEALED. All of this is presentation. A report must not verify
 * differently because somebody renamed the site or corrected their privacy
 * policy, and the boundary check forbids the seal and chain code from
 * reaching the server's site module.
 *
 * The catalogue of palettes and themes and the name parser live here rather
 * than on one side because both sides need them: the server validates a
 * choice and builds the web manifest; the website paints the choice and
 * previews a name while it is typed.
 */
import { z } from 'zod';
import { Figure } from './board.ts';
import { LookKitPath, LookOptions } from './look/header.ts';
import { ENUMS } from './look/pack.ts';
import type { ThemeLayout } from './look/pack.ts';
import { defineRoute } from './route.ts';
import {
  MAX_SOCIAL_ADDRESS,
  PublicSocialLink,
  SOCIAL_FLOAT_PAGES,
  SocialFloat,
  SocialLink,
  SocialPlacementSchema,
} from './social.ts';

export * from './social.ts';

// ── the look ────────────────────────────────────────────────────────────

/**
 * PALETTE owns every colour; THEME owns type, corners, shadow and width,
 * and sets no colour. Any theme works with any palette. The catalogue is the
 * built-in look pack (look/reportlog-core.look.json), and the website's
 * stylesheet is written from the same file, so every id here has a block in
 * styles.css and every block has an id here; the website's suite checks both
 * directions.
 */
export {
  CORE_PACK,
  DEFAULT_LOOK,
  LEGACY_LOOK,
  LOOKS,
  PREVIOUS_DEFAULT_LOOK,
  PALETTES,
  PALETTE_IDS,
  RETIRED_IDS,
  THEMES,
  THEME_IDS,
  isDarkPalette,
  layoutOf,
} from './look/core.ts';
export * from './look/pack.ts';

/**
 * Ids rather than an enum: look packs add palettes and themes without a
 * deploy, so which ids exist is the server's to say. The server never sends
 * one it has no stylesheet for (`resolveLook`).
 */
const LookId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);

/**
 * An installed pack's stylesheet: a path on this site, named by its hash.
 * Held to this exact shape wherever it is read (a remembered look in
 * localStorage included), so nothing can make the page link another host.
 */
export const LOOK_STYLESHEET = /^\/api\/looks\/[a-z][a-z0-9-]{1,39}\/[0-9a-f]{64}\.css$/;
export const LookStylesheet = z.string().regex(LOOK_STYLESHEET);
export const Look = z.object({ palette: LookId, theme: LookId });
export type Look = z.infer<typeof Look>;

/**
 * The look as the page paints it: the two ids, and the theme's layout
 * choices, which become `data-panel-head`, `data-texture`, `data-width`,
 * `data-columns`, `data-scale` and `data-surface` on <html>. A theme picks
 * between layouts the app already has; it cannot describe one.
 */
export const PaintedLook = Look.extend({
  panel_head: z.enum(ENUMS.panelHead),
  texture: z.enum(ENUMS.texture),
  /**
   * The four later choices. Optional because a look remembered in a browser
   * before they existed must still parse; the page then takes the built-in
   * theme's (or the default's). The server always sends them.
   */
  width: z.enum(ENUMS.width).optional(),
  columns: z.enum(ENUMS.columns).optional(),
  scale: z.enum(ENUMS.scale).optional(),
  surface: z.enum(ENUMS.surface).optional(),
  /**
   * Whether the palette's page is dark, so Easier reading can pick High
   * contrast or High contrast dark for a palette from an installed pack too.
   * Optional because a look the page made itself (a preview, the setup
   * wizard's choice) does not know it; the server always sends it.
   */
  dark: z.boolean().optional(),
  /**
   * Every installed look pack's stylesheet, on this site only (stage 6).
   * The page links each after the built-in looks. Absent on a look the page
   * made itself, which leaves the links as they are; the server always
   * sends it, empty when there are no packs.
   */
  stylesheets: z.array(LookStylesheet).max(100).optional(),
  /** Format 2 themes: the headline's second line and its tag. Optional like the four above. */
  second: z.enum(ENUMS.second).optional(),
  tag: z.enum(ENUMS.tag).optional(),
  /**
   * Zones, motion and the header background (look/header.ts). Optional so a
   * look remembered before they existed still parses; the page then draws
   * the defaults until the server answers.
   */
  options: LookOptions.optional(),
  /**
   * Each installed pack's header kit (its elements and shapes), by address.
   * Fetched by the page only where a header background is drawn.
   */
  kits: z.array(LookKitPath).max(100).optional(),
});
export type PaintedLook = z.infer<typeof PaintedLook>;

/** A theme's layout choices, as PaintedLook names them. */
export function paintedLayout(
  layout: ThemeLayout,
): Pick<
  PaintedLook,
  'panel_head' | 'texture' | 'width' | 'columns' | 'scale' | 'surface' | 'second' | 'tag'
> {
  return {
    second: layout.second,
    tag: layout.tag,
    panel_head: layout.panelHead,
    texture: layout.texture,
    width: layout.width,
    columns: layout.columns,
    scale: layout.scale,
    surface: layout.surface,
  };
}

// ── the name ────────────────────────────────────────────────────────────

/** The software's own name, which the footer keeps whatever the site is called. */
export const SOFTWARE_NAME = 'ReportLog';

/**
 * Where the software's source is published, and under what licence. The
 * footer names both on every deployment, whatever it calls itself: AGPL
 * attribution belongs where a reader can see it, and a deployment renaming
 * itself is not a deployment claiming to have written the software.
 */
export const SOFTWARE_SOURCE = 'https://github.com/munsdev/reportlog';
export const SOFTWARE_LICENCE = 'AGPL-3.0-or-later';

/** A name has to fit in a page header and a mail subject. Counted without the marks. */
export const MAX_SITE_NAME = 60;

/**
 * The two-tone name. Runs wrapped in straight double quotes take the first
 * accent (the palette's brand colour), runs in single quotes the second
 * (its muted text):
 *
 *   Report"Log"          Report, then Log in the first accent
 *   The"Ruhr"Line'.org'  both accents in one name
 *   Munich Archive       one colour
 *
 * Two and no more, because a third would have to borrow a status colour,
 * and a name in teal would be saying a moderator confirmed it.
 *
 * A QUOTE THAT DOES NOT CLOSE IS A CHARACTER, NOT A MARK. `Munich's Log`
 * keeps its apostrophe instead of losing half the name to an accent nobody
 * asked for. Only when both kinds fail to close is the name drawn flat with
 * the quotes stripped. The quotes themselves are never shown: tabs, mail
 * subjects and the manifest use `plainName`.
 */
export interface BrandPart {
  text: string;
  mark: '' | 'a' | 'b';
}

const MARK_OF: Record<string, 'a' | 'b'> = { '"': 'a', "'": 'b' };

/** One pass honouring only the quote kinds in `active`; null if one is left open. */
function scan(name: string, active: string): BrandPart[] | null {
  const parts: BrandPart[] = [];
  let buf = '';
  let open: string | null = null;
  const push = (text: string, mark: BrandPart['mark']) => {
    if (text) parts.push({ text, mark });
  };
  for (const ch of name) {
    if (open === null && active.includes(ch)) {
      push(buf, '');
      buf = '';
      open = ch;
    } else if (open === ch) {
      push(buf, MARK_OF[ch] ?? '');
      buf = '';
      open = null;
    } else {
      buf += ch;
    }
  }
  if (open !== null) return null;
  push(buf, '');
  return parts;
}

/** The name as ordered runs. Always at least one run, so no caller has to check. */
export function parseBrand(raw: string): BrandPart[] {
  const parts = scan(raw, `"'`) ??
    scan(raw, '"') ??
    scan(raw, "'") ?? [{ text: raw.split('"').join('').split("'").join(''), mark: '' }];
  return parts.length ? parts : [{ text: '', mark: '' }];
}

/** The name with no markup in it. */
export function plainName(raw: string): string {
  return parseBrand(raw)
    .map((p) => p.text)
    .join('');
}

/**
 * Whether the name reads exactly as written. False only for an unclosed
 * DOUBLE quote: nobody puts one in the middle of a name, so it is a typo
 * and the field says so. An unclosed single quote is an apostrophe and is
 * left alone, or every possessive would be refused.
 */
export function accentMarksClose(raw: string): boolean {
  return scan(raw, '"') !== null;
}

export const BrandPartSchema = z.object({ text: z.string(), mark: z.enum(['', 'a', 'b']) });

// ── the words on the site's own pages ───────────────────────────────────

/**
 * The slots an operator may write. Each one is read by a page; offering a
 * slot nothing reads would be a text box that does nothing, so a slot is
 * added here by whoever builds the page that shows it. The wording, help
 * and fallbacks are the server's (apps/api/src/site/copy.ts).
 */
export const COPY_KEYS = [
  'home_headline',
  'home_lede',
  'home_intro',
  'about_archive',
  'submit_intro',
  'submit_question',
  'send_note',
  // Plan E: the one sentence a refusal at the door shows (apps/api/src/door/).
  'refusal_message',
  'board_intro',
  'how_intro',
  'alliance_intro',
  'standards',
  'lock_intro',
  // D4: the terms of use and the two contact points, linked from every page.
  'terms_of_use',
  'contact_users',
  'contact_authorities',
  // Plan E (PE3): where a report came from, and the paused-intake notice.
  'origin_open_form',
  'origin_organization',
  'intake_paused_notice',
  // Decision 62: the emergency notice on the front page and the filing landing.
  'help_now',
  // Decision 78: heading and optional button of that box.
  'cta_heading',
  'cta_button_text',
  'cta_button_url',
  // The public shell: the slogan bar under the front page headline, and the
  // strip under the header. Both are the operator's words, so both ship empty.
  'home_slogan',
  'ticker_text',
  // The Follow along band's heading and line (D11), the same on every page it is on.
  'follow_heading',
  'follow_line',
  // The footer's slogan: two lines, the second quieter.
  'footer_slogan',
] as const;
export type CopyKey = (typeof COPY_KEYS)[number];
export const CopyKeySchema = z.enum(COPY_KEYS);

// ── the front page's quieter sections ───────────────────────────────────

/**
 * What sits under the front page's buttons, which an administrator may hide
 * and reorder (the on-page editor, decided 22 October 2026). The headline,
 * the buttons and the emergency notice are not here: they are the page, and
 * the notice may not be removed (decision 62).
 */
export const HOME_SECTIONS = ['intro', 'check', 'map', 'figures', 'links', 'social'] as const;
export type HomeSectionId = (typeof HOME_SECTIONS)[number];
export const HomeSectionIdSchema = z.enum(HOME_SECTIONS);

export const HomeSection = z.object({ id: HomeSectionIdSchema, shown: z.boolean() });
export type HomeSection = z.infer<typeof HomeSection>;

/** What each section is called in the editor. */
export const HOME_SECTION_NAMES: Record<HomeSectionId, string> = {
  intro: 'What this archive is for',
  check: 'Check a report',
  map: 'The map',
  figures: 'The figures',
  links: 'More you can do',
  social: 'Follow us elsewhere',
};

/**
 * The sections as stored, made whole: an id this release does not know is
 * dropped, a repeat is dropped, and a section the list does not name is
 * appended, shown, so one added in a later release still appears. Anything
 * that is not a list (NULL included) is the shipped order. One function, used
 * by the server on read and on write and by the page, so they cannot differ.
 */
export function resolveHomeSections(stored: unknown): HomeSection[] {
  const out: HomeSection[] = [];
  if (Array.isArray(stored)) {
    for (const raw of stored as unknown[]) {
      const parsed = HomeSection.safeParse(raw);
      if (parsed.success && !out.some((s) => s.id === parsed.data.id)) out.push(parsed.data);
    }
  }
  for (const id of HOME_SECTIONS) {
    if (!out.some((s) => s.id === id)) out.push({ id, shown: true });
  }
  return out;
}

// ── what every page reads ───────────────────────────────────────────────

/**
 * Which release this is, for the footer. `release` is the version in the
 * repository's package.json (`v1.2.3`); `build` is the commit a deployment
 * unpacked (the release's REVISION file). Either is null where there is
 * none, as in a development checkout, and the footer then says nothing
 * rather than inventing a number.
 */
export const SiteVersion = z.object({
  release: z.string().nullable(),
  build: z.string().nullable(),
});
export type SiteVersion = z.infer<typeof SiteVersion>;

export const Site = z.object({
  software_name: z.string(),
  /** As stored, with its accent marks. */
  name: z.string(),
  name_parts: z.array(BrandPartSchema).min(1),
  plain_name: z.string(),
  look: PaintedLook,
  /**
   * Every slot resolved: what the operator wrote, or what ships. Never
   * missing; an optional slot nobody wrote is ''. Any {{ … }} figure in it is
   * already a number (or "?" while the archive is not public).
   */
  copy: z.record(CopyKeySchema, z.string()),
  /**
   * When the development notice switches itself off, or null when it is
   * off. An expiry rather than a flag, so the page can hide the notice at
   * that moment without asking again.
   */
  dev_mode_until: z.string().nullable(),
  version: SiteVersion,
  /**
   * The front page's quieter sections, whole and in order. Optional only so
   * a page holding an older answer still draws; the server always sends it,
   * and the page reads it through `resolveHomeSections`.
   */
  home_sections: z.array(HomeSection).optional(),
  /**
   * The accounts elsewhere that are switched on, in order. Optional for the
   * same reason as `home_sections`; the server always sends it.
   */
  social_links: z.array(PublicSocialLink).optional(),
  /**
   * The pages that carry the floating button. Present only while it is on
   * and an account is shown; absent otherwise, so most pages never see it.
   */
  social_float_pages: z.array(z.enum(SOCIAL_FLOAT_PAGES)).optional(),
  /**
   * The placements switched on (menu, ticker, footer, the Follow along
   * bands). Optional so a page holding an older answer still draws, as
   * every placement; the server always sends it.
   */
  social_placements: z.array(SocialPlacementSchema).optional(),
});
export type Site = z.infer<typeof Site>;

export const getSite = defineRoute({
  method: 'GET',
  path: '/api/site',
  summary: "This deployment's name, look and page wording.",
  response: Site,
});

/**
 * The operator's imprint and privacy policy. NULL means nobody has
 * published one, and the page says exactly that: a placeholder that reads
 * like a legal notice is worse than none.
 */
export const LEGAL_KINDS = ['impressum', 'privacy'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];
export const LegalKindSchema = z.enum(LEGAL_KINDS);
export const MAX_LEGAL_TEXT = 100000;

export const Legal = z.object({ impressum: z.string().nullable(), privacy: z.string().nullable() });
export type Legal = z.infer<typeof Legal>;

export const getLegal = defineRoute({
  method: 'GET',
  path: '/api/legal',
  summary: "The operator's imprint and privacy policy, or null for each not published.",
  response: Legal,
});

/** The installable app's description. Built per deployment so the icon wears the site's name. */
export const WebManifest = z.object({
  id: z.string(),
  name: z.string(),
  short_name: z.string(),
  description: z.string(),
  start_url: z.string(),
  scope: z.string(),
  display: z.string(),
  display_override: z.array(z.string()),
  background_color: z.string(),
  theme_color: z.string(),
  lang: z.string(),
  dir: z.string(),
  icons: z.array(
    z.object({ src: z.string(), sizes: z.string(), type: z.string(), purpose: z.string() }),
  ),
});
export type WebManifest = z.infer<typeof WebManifest>;

export const getWebManifest = defineRoute({
  method: 'GET',
  path: '/api/site/manifest.webmanifest',
  summary: 'The web app manifest, in this deployment’s name and colours.',
  response: WebManifest,
});

// The front page's buttons are workstream B's: see `getHomeButtons` in
// logbooks.ts. This file once had a second copy; the two were merged into
// B's, which also knows when a logbook closes.

// ── the settings screens ────────────────────────────────────────────────

export const CopySlot = z.object({
  key: CopyKeySchema,
  kind: z.enum(['line', 'block']),
  label: z.string(),
  help: z.string(),
  optional: z.boolean(),
  fallback: z.string(),
  /** What the editor opens with: the operator's words, or the fallback. */
  body: z.string(),
  /** False while the slot still carries the shipped wording. */
  written: z.boolean(),
  /** When the operator's words were last saved; null while it is the shipped wording. */
  changed_at: z.string().nullable(),
});
export type CopySlot = z.infer<typeof CopySlot>;

export const LegalEditor = z.object({
  kind: LegalKindSchema,
  /** What was published, or the outline when nothing was. */
  text: z.string(),
  /** False while the editor holds the outline: saving it would publish the outline. */
  published: z.boolean(),
});

export const SiteEditor = z.object({
  look: Look,
  /** Zones, motion and the header background, whole. */
  look_options: LookOptions,
  /** The stored name, or null when the site uses the default. */
  name: z.string().nullable(),
  effective_name: z.string(),
  copy: z.array(CopySlot),
  legal: z.array(LegalEditor),
  /** The front page's quieter sections, whole and in order. */
  home_sections: z.array(HomeSection),
  /** Every platform, in order, with its address and whether it shows. */
  social_links: z.array(SocialLink),
  /** The floating "Follow us" button's switch and pages. */
  social_float: SocialFloat,
  /** The placements that are on. */
  social_placements: z.array(SocialPlacementSchema),
});
export type SiteEditor = z.infer<typeof SiteEditor>;

export const getSiteEditor = defineRoute({
  method: 'GET',
  path: '/api/admin/site',
  summary: 'Everything the site settings screens edit.',
  response: SiteEditor,
});

/**
 * One axis at a time is fine: a palette change does not carry a theme with
 * it. Strings rather than enums so a refusal is a sentence, not a schema
 * error.
 */
export const setLook = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/look',
  summary: 'Choose the palette, the theme, or both.',
  body: z.object({ palette: z.string().optional(), theme: z.string().optional() }),
  response: SiteEditor,
});

/**
 * Zones, motion and the header background, whole. Owner only (the page that
 * every visitor sees first). `image.file` must be the one already uploaded,
 * or null; a different name is refused, so no stored file name can be made
 * to point somewhere else.
 */
export const setLookOptions = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/look-options',
  summary: 'Set how sections alternate, whether decoration moves, and the header background.',
  body: LookOptions,
  response: SiteEditor,
});

/**
 * The header image. The body is the picture itself, not JSON (the page has
 * already scaled it to 1600 px). It is decoded and re-encoded before it is
 * kept, so nothing but the picture survives. Owner only.
 */
export const uploadHeaderImage = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/header-image',
  summary: 'Replace the header image with the image in the body.',
  response: SiteEditor,
});
export const removeHeaderImage = defineRoute({
  method: 'DELETE',
  path: '/api/admin/site/header-image',
  summary: 'Remove the header image.',
  response: SiteEditor,
});
/** Where the header image is served from, behind the site password like the pages it appears on. */
export const HEADER_IMAGE_ROUTE = '/api/site/header-image/:file';

export const setSiteName = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/name',
  summary: "Rename the site. Null goes back to the software's name.",
  body: z.object({ name: z.string().nullable() }),
  response: SiteEditor,
});

export const setCopy = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/copy/:key',
  summary: 'Write one slot of page wording. Empty goes back to what ships.',
  params: z.object({ key: z.string() }),
  body: z.object({ body: z.string() }),
  response: SiteEditor,
});

/**
 * The front page's quieter sections, in order, each shown or hidden. Ids as
 * strings, so an unknown one is refused in a sentence, not a schema error.
 */
export const setHomeSections = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/home-sections',
  summary: "Choose which of the front page's quieter sections show, and their order.",
  body: z.object({
    sections: z.array(z.object({ id: z.string(), shown: z.boolean() })).max(20),
  }),
  response: SiteEditor,
});

/**
 * Every account at once, as the screen holds them. Ids and addresses as
 * strings, so an unknown platform or an address on the wrong site is
 * refused in a sentence, not a schema error. A platform left out is kept as
 * it was.
 */
export const setSocialLinks = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/social',
  summary: 'Set the addresses of the site’s social media accounts, and which show.',
  body: z.object({
    links: z
      .array(
        z.object({
          id: z.string(),
          address: z.string().max(MAX_SOCIAL_ADDRESS * 2),
          shown: z.boolean(),
        }),
      )
      .max(40),
    /** The floating button. Left out, it is kept as it was. */
    float: z.object({ on: z.boolean(), pages: z.array(z.string()).max(20) }).optional(),
    /** The placements that are on. Left out, they are kept as they were. */
    placements: z.array(z.string()).max(40).optional(),
  }),
  response: SiteEditor,
});

export const setLegalText = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/legal/:kind',
  summary: 'Publish the imprint or the privacy policy. Empty takes it down.',
  params: z.object({ kind: LegalKindSchema }),
  body: z.object({ text: z.string() }),
  response: SiteEditor,
});

/** The development notice, as the settings screen sees it. */
export const DevMode = z.object({
  active: z.boolean(),
  /** When it switches itself off; null when it is off. */
  until: z.string().nullable(),
  /** How long "turn it on" turns it on for, and how long a deploy arms it. */
  default_hours: z.number().int(),
  max_hours: z.number().int(),
});
export type DevMode = z.infer<typeof DevMode>;

export const getDevMode = defineRoute({
  method: 'GET',
  path: '/api/admin/site/dev-mode',
  summary: 'Whether the "under active development" notice is showing, and until when.',
  response: DevMode,
});

/**
 * A switch, not a form: it applies at once. A deploy arms the notice by
 * itself, so this is the manual override, on for a window or off now.
 */
export const setDevMode = defineRoute({
  method: 'PUT',
  path: '/api/admin/site/dev-mode',
  summary: 'Show the development notice for some hours, or (null) take it down now.',
  body: z.object({ hours: z.number().nullable() }),
  response: DevMode,
});

/**
 * Every figure an operator can put in their page wording, with its value
 * now, for the editor's "insert a number". Administrators only, and served
 * whether or not the archive is public: the editor needs the names either
 * way. The public pages render them only while it is.
 */
export const getCopyFigures = defineRoute({
  method: 'GET',
  path: '/api/admin/site/figures',
  summary: 'The figures page wording may contain, with their values now.',
  response: z.object({ figures: z.array(Figure) }),
});

// ── feedback ────────────────────────────────────────────────────────────
//
// The in-app issue tracker. Not reports: nothing here is evidence, and
// nothing here is sealed. Open to testers (a flag, not a role), and to
// administrators and Access Managers. A tester sees issues and never a
// report.

export const FEEDBACK_TYPES = ['bug', 'question', 'suggestion'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** Blocker, major, minor rather than a number: a tester picks these right without being told what P1 means. */
export const FEEDBACK_SEVERITIES = ['blocker', 'major', 'minor'] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

export const FEEDBACK_STATUSES = [
  'new', // filed, not looked at yet
  'investigating', // acknowledged, being reproduced
  'in_progress', // being fixed
  'need_info', // waiting on the tester
  'acknowledged', // noted, nothing to fix: closes a question or a suggestion
  'fixed',
  'wont_fix',
  'duplicate',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Everything still waiting on somebody. The weekly digest lists every one of these. */
export const OPEN_FEEDBACK_STATUSES = [
  'new',
  'investigating',
  'in_progress',
  'need_info',
] as const satisfies readonly FeedbackStatus[];

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'Something is broken',
  question: 'A question',
  suggestion: 'A suggestion',
};

export const FEEDBACK_SEVERITY_LABELS: Record<FeedbackSeverity, string> = {
  blocker: 'It stops me doing something',
  major: 'It gets in the way',
  minor: 'Small, or cosmetic',
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'New',
  investigating: 'Being looked into',
  in_progress: 'Being fixed',
  need_info: 'Needs more from you',
  acknowledged: 'Noted',
  fixed: 'Fixed',
  wont_fix: 'Will not be fixed',
  duplicate: 'Already reported',
};

export const MAX_FEEDBACK_TITLE = 200;
export const MAX_FEEDBACK_BODY = 5000;

const FeedbackTypeSchema = z.enum(FEEDBACK_TYPES);
const FeedbackSeveritySchema = z.enum(FEEDBACK_SEVERITIES);
const FeedbackStatusSchema = z.enum(FEEDBACK_STATUSES);

/** Where the tester was and what they were using. The server keeps only these, shortened. */
export const FeedbackContext = z.object({
  /** The screen, as the router names it (never the address, which can carry a token). */
  page: z.string().max(200).optional(),
  viewport: z.string().max(40).optional(),
  browser: z.string().max(400).optional(),
});
export type FeedbackContext = z.infer<typeof FeedbackContext>;

/** One issue as a tester sees it. Authors are shown as a masked handle, never an address. */
export const FeedbackIssue = z.object({
  id: z.number().int(),
  type: FeedbackTypeSchema,
  severity: FeedbackSeveritySchema,
  title: z.string(),
  body: z.string(),
  related_ref: z.string().nullable(),
  status: FeedbackStatusSchema,
  created_at: z.string(),
  status_changed_at: z.string(),
  author: z.string(),
  mine: z.boolean(),
  comment_count: z.number().int(),
});
export type FeedbackIssue = z.infer<typeof FeedbackIssue>;

export const FeedbackStatusChange = z.object({
  status: FeedbackStatusSchema,
  note: z.string(),
  created_at: z.string(),
});

export const FeedbackComment = z.object({
  author: z.string(),
  mine: z.boolean(),
  body: z.string(),
  created_at: z.string(),
});

export const FeedbackDetail = FeedbackIssue.extend({
  context: FeedbackContext,
  /** Each change of status with the note the tester was sent, oldest first. */
  changes: z.array(FeedbackStatusChange),
  comments: z.array(FeedbackComment),
});
export type FeedbackDetail = z.infer<typeof FeedbackDetail>;

/**
 * Strings rather than enums for what a person chooses or types, so a refusal
 * is a sentence and not a schema error.
 */
export const fileFeedback = defineRoute({
  method: 'POST',
  path: '/api/feedback',
  summary: 'File an issue about the site itself. Testers, administrators and Access Managers.',
  body: z.object({
    type: z.string().max(40),
    severity: z.string().max(40),
    title: z.string().max(1000),
    body: z.string().max(20000),
    related_ref: z.string().max(200).optional(),
    context: FeedbackContext.optional(),
  }),
  response: z.object({ id: z.number().int() }),
});

export const listFeedback = defineRoute({
  method: 'GET',
  path: '/api/feedback',
  summary: "Every tester's issues, newest first, so a duplicate is seen before it is filed.",
  response: z.object({ issues: z.array(FeedbackIssue) }),
});

export const getFeedback = defineRoute({
  method: 'GET',
  path: '/api/feedback/:id',
  summary: 'One issue, with its changes of status and its comments.',
  params: z.object({ id: z.coerce.number().int().positive() }),
  response: FeedbackDetail,
});

export const commentOnFeedback = defineRoute({
  method: 'POST',
  path: '/api/feedback/:id/comments',
  summary: 'Add a comment to an issue. Comments are never edited.',
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ body: z.string().max(20000) }),
  response: FeedbackDetail,
});

/** An issue as an administrator sees it: the same, with the addresses. */
export const FeedbackQueueItem = FeedbackIssue.extend({ submitter_email: z.string() });

export const getFeedbackQueue = defineRoute({
  method: 'GET',
  path: '/api/admin/feedback',
  summary: 'Every issue, newest first, optionally of one status or every open one.',
  query: z.object({ status: z.string().max(40).optional() }),
  response: z.object({
    counts: z.record(z.string(), z.number().int()),
    open: z.number().int(),
    issues: z.array(FeedbackQueueItem),
  }),
});

export const AdminFeedbackDetail = FeedbackDetail.extend({
  submitter_email: z.string(),
  changes: z.array(FeedbackStatusChange.extend({ by: z.string() })),
  comments: z.array(FeedbackComment.extend({ author_email: z.string() })),
});
export type AdminFeedbackDetail = z.infer<typeof AdminFeedbackDetail>;

export const getFeedbackAdmin = defineRoute({
  method: 'GET',
  path: '/api/admin/feedback/:id',
  summary: 'One issue, with who filed it and who changed it.',
  params: z.object({ id: z.coerce.number().int().positive() }),
  response: AdminFeedbackDetail,
});

export const setFeedbackStatus = defineRoute({
  method: 'POST',
  path: '/api/admin/feedback/:id/status',
  summary:
    'Move an issue. The note is required: it is emailed to the tester and shown on the issue.',
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ status: z.string().max(40), note: z.string().max(20000) }),
  response: AdminFeedbackDetail,
});

export const Tester = z.object({ email: z.string(), roles: z.array(z.string()) });

export const listTesters = defineRoute({
  method: 'GET',
  path: '/api/admin/testers',
  summary: 'Everybody with the tester flag. Administrators and Access Managers.',
  response: z.object({ testers: z.array(Tester) }),
});

export const setTester = defineRoute({
  method: 'POST',
  path: '/api/admin/testers',
  summary: 'Give or take the tester flag. It opens the feedback tracker and nothing else.',
  body: z.object({ email: z.string().max(320), tester: z.boolean() }),
  response: z.object({ ok: z.literal(true), unchanged: z.boolean() }),
});

// ── email updates about published reports ───────────────────────────────

export const DIGEST_FREQUENCIES = ['none', 'hourly', 'weekly'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export const Notifications = z.object({
  frequency: z.enum(DIGEST_FREQUENCIES),
  /** Slugs followed, or null for every logbook. */
  logbooks: z.array(z.string()).nullable(),
  /** The logbooks that can be followed: every launched one. */
  choices: z.array(z.object({ slug: z.string(), title: z.string() })),
});
export type Notifications = z.infer<typeof Notifications>;

export const getNotifications = defineRoute({
  method: 'GET',
  path: '/api/notifications',
  summary:
    'How often the signed-in person hears about newly published reports, and from which logbooks.',
  response: Notifications,
});

export const setNotifications = defineRoute({
  method: 'PUT',
  path: '/api/notifications',
  summary:
    'Choose how often to hear about newly published reports. An empty list is every logbook.',
  body: z.object({
    frequency: z.string().max(20),
    logbooks: z.array(z.string().max(80)).max(200).nullable(),
  }),
  response: Notifications,
});

// ── the directory of organizations ──────────────────────────────────────
//
// Organizations that asked to be listed. NOT CHAINED: who is currently
// willing to stand beside the project is not archive material.

export const DIRECTORY_NAME = 'Participating organizations';

/**
 * Served WITH the rows, so a page cannot show the directory without the
 * sentence that says what it is not. Any directory of organizations reads
 * as a membership body with a bar to clear, and no such bar exists.
 */
export const DIRECTORY_DISCLAIMER =
  'Listing here is not verification. These organizations asked to be listed; nobody has ' +
  'checked them against a standard, because no standard for verifying an organization has ' +
  'been published yet. Treat this as a list of who is taking part, not as an endorsement ' +
  'of any of them.';

/**
 * What appears publicly when an organization is listed. "List us publicly"
 * is not an adequate question: the member count is a number about them that
 * did not exist before they were asked.
 */
export const DIRECTORY_WHAT_APPEARS = [
  'The organization’s name, its description, and its logo if it has one.',
  'The date it joined the directory.',
  'How many people have accepted an invitation to it: an exact number, not a range.',
] as const;

/** Said where the decision is made, so leaving does not do less than somebody expected. */
export const DIRECTORY_LEAVING =
  'Leaving the directory does not remove this organization from the reports it has already ' +
  'filed. That is part of each report and cannot be changed.';

export const DirectoryEntry = z.object({
  name: z.string(),
  details: z.string().nullable(),
  joined: z.string(),
  member_count: z.number().int(),
  /** Where its logo is served from, or null when it has none. */
  logo: z.string().nullable(),
});

export const getDirectory = defineRoute({
  method: 'GET',
  path: '/api/directory',
  summary:
    'The organizations that asked to be listed, largest first, with what listing does not mean.',
  response: z.object({
    name: z.string(),
    disclaimer: z.string(),
    organizations: z.array(DirectoryEntry),
  }),
});

export const Listing = z.object({
  organization: z.string(),
  listed: z.boolean(),
  joined: z.string().nullable(),
  member_count: z.number().int(),
  directory_name: z.string(),
  what_appears: z.array(z.string()),
  disclaimer: z.string(),
  leaving: z.string(),
});
export type Listing = z.infer<typeof Listing>;

export const getListing = defineRoute({
  method: 'GET',
  path: '/api/directory/listing/:id',
  summary: 'Whether an organization is listed. Its managers and administrators.',
  params: z.object({ id: z.coerce.number().int().positive() }),
  response: Listing,
});

export const setListing = defineRoute({
  method: 'PUT',
  path: '/api/directory/listing/:id',
  summary:
    'List an organization in the directory, or take it out. Its managers and administrators.',
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ listed: z.boolean() }),
  response: Listing,
});
