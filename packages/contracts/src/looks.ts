/**
 * Look packs (stage 6 of the interface redesign; docs/design/looks/README.md
 * section 05): checking, installing, listing and removing the packs an
 * operator adds without a deploy, and where their files are served.
 *
 * Owner and administrators only. Installing, replacing and removing ask for
 * the step-up (decision 50); checking changes nothing and does not.
 *
 * THE ZIP TRAVELS AS BASE64 IN JSON, not as a raw body: the step-up is asked
 * for and the call repeated by the website's one API client (lib/api.ts),
 * which speaks JSON. A pack is at most 10 MB, so a third more on the wire is
 * a fair price for not having a second path that has to remember to do it.
 */
import { z } from 'zod';
import { ENUMS } from './look/pack.ts';
import { defineRoute } from './route.ts';
import { LookStylesheet } from './site.ts';

/** A zip larger than this is refused before it is read: 10 MB of files, plus the zip's own records. */
export const LOOK_PACK_MAX_ZIP_BYTES = 11_000_000;
const MAX_BASE64 = Math.ceil(LOOK_PACK_MAX_ZIP_BYTES / 3) * 4;

/** Where a pack's stylesheet, fonts and header kit are served: `<sha256>.css`, `.woff2` or `.json`. */
export const LOOK_FILES_PATH = '/api/looks/:pack/:file';

const Iso = z.string();
const Hex = z.string().regex(/^#[0-9a-f]{6}$/);
const Ok = z.object({ ok: z.literal(true) });

/** A palette as the upload screen shows it: its words, and four colours for a strip. */
export const PackPalette = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  dark: z.boolean(),
  background: Hex,
  deep: Hex,
  surface: Hex,
  action: Hex,
});
export type PackPalette = z.infer<typeof PackPalette>;

export const PackTheme = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  panelHead: z.enum(ENUMS.panelHead),
  texture: z.enum(ENUMS.texture),
  // Optional so a summary from before the theme could choose them still
  // reads; the server always sends them.
  width: z.enum(ENUMS.width).optional(),
  columns: z.enum(ENUMS.columns).optional(),
  scale: z.enum(ENUMS.scale).optional(),
  surface: z.enum(ENUMS.surface).optional(),
  second: z.enum(ENUMS.second).optional(),
  tag: z.enum(ENUMS.tag).optional(),
});
export type PackTheme = z.infer<typeof PackTheme>;

export const PackLook = z.object({
  id: z.string(),
  label: z.string(),
  palette: z.string(),
  theme: z.string(),
});
export type PackLook = z.infer<typeof PackLook>;

/** What a pack adds. */
export const LookPackSummary = z.object({
  id: z.string(),
  label: z.string(),
  version: z.string(),
  author: z.string().optional(),
  palettes: z.array(PackPalette),
  themes: z.array(PackTheme),
  looks: z.array(PackLook),
  /** The font families it ships. */
  fonts: z.array(z.string()),
  /** Format 2: credit for a shape or font, shown beside the pack. */
  credit: z.string().optional(),
  /** Format 2: what it adds to the header background. */
  elements: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
});
export type LookPackSummary = z.infer<typeof LookPackSummary>;

export const InstalledLookPack = LookPackSummary.extend({
  installed_at: Iso,
  installed_by: z.string(),
  stylesheet: LookStylesheet,
  /** Why it cannot be removed today, in words, or null when it can. */
  in_use: z.string().nullable(),
});
export type InstalledLookPack = z.infer<typeof InstalledLookPack>;

const ZipBody = z.object({
  /** The .zip, base64. */
  zip: z
    .string()
    .max(MAX_BASE64)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});

export const listLookPacks = defineRoute({
  method: 'GET',
  path: '/api/admin/looks',
  summary: 'The installed look packs and what each adds. Owner and administrators.',
  response: z.object({ packs: z.array(InstalledLookPack) }),
});

export const checkLookPack = defineRoute({
  method: 'POST',
  path: '/api/admin/looks/check',
  summary: 'Check a look pack without installing it: every problem, in words.',
  body: ZipBody,
  response: z.object({
    /** Empty means it may be installed. */
    problems: z.array(z.string()),
    /** What it would add; null when it could not be read at all. */
    pack: LookPackSummary.nullable(),
    /** The version it would replace, or null for a new pack. */
    replaces: z.string().nullable(),
  }),
});

export const installLookPack = defineRoute({
  method: 'POST',
  path: '/api/admin/looks',
  summary: 'Install a look pack, or replace one with a higher version. Asks for the step-up.',
  body: ZipBody,
  response: z.object({ pack: InstalledLookPack, replaced: z.string().nullable() }),
});

export const removeLookPack = defineRoute({
  method: 'DELETE',
  path: '/api/admin/looks/:id',
  summary: 'Remove a look pack the site is not wearing. Asks for the step-up.',
  params: z.object({ id: z.string().max(40) }),
  response: Ok,
});
