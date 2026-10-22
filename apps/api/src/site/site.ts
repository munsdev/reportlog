/** What the public pages read, and what the settings screens edit, each in one go. */
import {
  LEGAL_KINDS,
  SOFTWARE_NAME,
  parseBrand,
  plainName,
  resolveHomeSections,
} from '@reportlog/contracts';
import type { CopyKey, Legal, Site, SiteEditor, SiteVersion } from '@reportlog/contracts';
import { figureValues, renderText } from '../board/figures.ts';
import { publicArchiveAvailable } from '../board/publication.ts';
import type { Database } from '../db/database.ts';
import { editorCopy, resolveCopy } from './copy.ts';
import { getDevMode } from './devMode.ts';
import { resolveSiteName } from './identity.ts';
import { editorStartingText, resolveLegalText } from './legal.ts';
import { lookCatalogue } from '../looks/packs.ts';
import { paintedLook, resolveLook } from './look.ts';
import { readCopy, readSettings } from './settings.ts';
import type { SettingsRow } from './settings.ts';

const LEGAL_COLUMN = { impressum: 'impressum_text', privacy: 'privacy_text' } as const;

const NO_VERSION: SiteVersion = { release: null, build: null };

/**
 * The page wording with its figures filled in.
 *
 * Only while the archive is public. The figures are counts of reports, and
 * D1's rule for /api/board/figures holds here too: "247 reports" on the
 * front page of a site that publishes none is the archive leaking through
 * the one door left open. While it is off, a placeholder shows "?", the
 * same as a figure that does not exist. The catalogue is only computed when
 * some slot actually holds a placeholder.
 */
export async function renderCopy(
  db: Database,
  copy: Record<CopyKey, string>,
): Promise<Record<CopyKey, string>> {
  const entries = Object.entries(copy) as [CopyKey, string][];
  if (!entries.some(([, text]) => text.includes('{{'))) return copy;
  const values = (await publicArchiveAvailable(db)) ? await figureValues(db) : {};
  return Object.fromEntries(entries.map(([k, text]) => [k, renderText(text, values)])) as Record<
    CopyKey,
    string
  >;
}

export async function publicSite(db: Database, version: SiteVersion = NO_VERSION): Promise<Site> {
  const [settings, rows, dev, looks] = await Promise.all([
    readSettings(db),
    readCopy(db),
    getDevMode(db),
    lookCatalogue(db),
  ]);
  const name = resolveSiteName(settings.site_name);
  return {
    software_name: SOFTWARE_NAME,
    name,
    name_parts: parseBrand(name),
    plain_name: plainName(name),
    look: paintedLook(settings, looks),
    copy: await renderCopy(db, resolveCopy(rows)),
    dev_mode_until: dev.until,
    version,
    home_sections: resolveHomeSections(settings.home_sections),
  };
}

export function legalFrom(settings: SettingsRow): Legal {
  return {
    impressum: resolveLegalText(settings.impressum_text),
    privacy: resolveLegalText(settings.privacy_text),
  };
}

export async function editorState(db: Database): Promise<SiteEditor> {
  const [settings, rows, looks] = await Promise.all([
    readSettings(db),
    readCopy(db),
    lookCatalogue(db),
  ]);
  return {
    look: resolveLook(settings, looks),
    name: settings.site_name,
    effective_name: resolveSiteName(settings.site_name),
    copy: editorCopy(rows),
    legal: LEGAL_KINDS.map((kind) => ({
      kind,
      ...editorStartingText(settings[LEGAL_COLUMN[kind]], kind),
    })),
    home_sections: resolveHomeSections(settings.home_sections),
  };
}
