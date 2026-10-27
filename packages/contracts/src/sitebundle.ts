/**
 * The site bundle: one JSON file holding how a site reads and looks, so a
 * whole site can be moved or set up by uploading it. Owner only.
 *
 * WHAT IT HOLDS: the site's name, its wording, the legal texts, the blocks of
 * its fixed pages, the front page's quieter sections, the social accounts
 * and where they show, the look (palette, theme, header background and
 * image), and the look packs. WHAT IT NEVER HOLDS: logbooks, questions,
 * lists, reports, entries, people, roles, files or anything sealed.
 *
 * EVERY PART IS OPTIONAL. A part that is in the file replaces what the site
 * has; a part that is not, stays as it is. Before an import writes anything,
 * the site's current values are kept (`site_bundle_backups`) so the owner can
 * put them back.
 */
import { z } from 'zod';
import { HeaderBackground, HeaderImage, LookOptions } from './look/header.ts';
import { Block, PageIdSchema } from './pages.ts';
import { defineRoute } from './route.ts';

export const BUNDLE_FORMAT = 1;
/** A bundle can hold a look pack (10 MB) and a header image; this is the most one request takes. */
export const BUNDLE_MAX_BYTES = 60_000_000;

/** The header image travels inside the file, as a data URL. */
const BundleImage = HeaderImage.omit({ file: true }).extend({
  data_url: z.string().max(9_000_000),
});
const BundleOptions = LookOptions.extend({
  header: HeaderBackground.extend({ image: BundleImage.nullable() }),
});
export type BundleOptions = z.infer<typeof BundleOptions>;

/** A look pack as its files: look.json as an object, and each font as base64. */
export const BundlePack = z.object({
  look: z.record(z.string(), z.unknown()),
  fonts: z.record(z.string().max(120), z.string()).optional(),
});
export type BundlePack = z.infer<typeof BundlePack>;

export const BundleSite = z.object({
  name: z.string().nullable().optional(),
  copy: z.record(z.string(), z.string()).optional(),
  legal: z
    .object({
      impressum: z.string().nullable().optional(),
      privacy: z.string().nullable().optional(),
    })
    .optional(),
  pages: z.partialRecord(PageIdSchema, z.array(Block)).optional(),
  home_sections: z.array(z.object({ id: z.string(), shown: z.boolean() })).optional(),
  social: z
    .object({
      links: z.array(z.object({ id: z.string(), address: z.string(), shown: z.boolean() })),
      float: z.object({ on: z.boolean(), pages: z.array(z.string()) }).optional(),
      placements: z.array(z.string()).optional(),
    })
    .optional(),
  look: z
    .object({
      palette: z.string().optional(),
      theme: z.string().optional(),
      options: BundleOptions.optional(),
    })
    .optional(),
  packs: z.array(BundlePack).optional(),
});
export type BundleSite = z.infer<typeof BundleSite>;

export const SiteBundle = z.object({
  format: z.literal(BUNDLE_FORMAT),
  exported_at: z.string(),
  site: BundleSite,
});
export type SiteBundle = z.infer<typeof SiteBundle>;

export const BundleBackupInfo = z.object({
  id: z.number(),
  created_at: z.string(),
  created_by: z.string(),
});
export type BundleBackupInfo = z.infer<typeof BundleBackupInfo>;

export const BundleResult = z.object({
  /** In words: what was written, and what was left as it was. */
  written: z.array(z.string()),
  skipped: z.array(z.string()),
  backup: BundleBackupInfo.nullable(),
});
export type BundleResult = z.infer<typeof BundleResult>;

export const exportSiteBundle = defineRoute({
  method: 'GET',
  path: '/api/owner/site-bundle',
  summary: "The site's wording, pages, accounts and look as one file. Owner only.",
  response: SiteBundle,
});

export const importSiteBundle = defineRoute({
  method: 'POST',
  path: '/api/owner/site-bundle',
  summary:
    'Replaces the parts of the site the file holds, after keeping what is there now. Owner only; asks for the step-up.',
  body: SiteBundle,
  response: BundleResult,
});

export const getBundleBackup = defineRoute({
  method: 'GET',
  path: '/api/owner/site-bundle/backup',
  summary: 'The newest kept copy of the settings from before an import, or none.',
  response: z.object({ backup: BundleBackupInfo.nullable() }),
});

export const restoreBundleBackup = defineRoute({
  method: 'POST',
  path: '/api/owner/site-bundle/restore',
  summary:
    'Puts the settings back as they were before the last import. Owner only; asks for the step-up.',
  response: BundleResult,
});
