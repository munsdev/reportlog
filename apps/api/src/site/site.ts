/** What the public pages read, and what the settings screens edit, each in one go. */
import { LEGAL_KINDS, SOFTWARE_NAME, parseBrand, plainName } from '@reportlog/contracts';
import type { Legal, Site, SiteEditor } from '@reportlog/contracts';
import type { Database } from '../db/database.ts';
import { editorCopy, resolveCopy } from './copy.ts';
import { availableButtons, parseStoredOrder, resolveButtons } from './homeButtons.ts';
import { resolveSiteName } from './identity.ts';
import { editorStartingText, resolveLegalText } from './legal.ts';
import { resolveLook } from './look.ts';
import { readCopy, readSettings } from './settings.ts';
import type { SettingsRow } from './settings.ts';

const LEGAL_COLUMN = { impressum: 'impressum_text', privacy: 'privacy_text' } as const;

export async function publicSite(db: Database): Promise<Site> {
  const [settings, rows] = await Promise.all([readSettings(db), readCopy(db)]);
  const name = resolveSiteName(settings.site_name);
  return {
    software_name: SOFTWARE_NAME,
    name,
    name_parts: parseBrand(name),
    plain_name: plainName(name),
    look: resolveLook(settings),
    copy: resolveCopy(rows),
  };
}

export function legalFrom(settings: SettingsRow): Legal {
  return {
    impressum: resolveLegalText(settings.impressum_text),
    privacy: resolveLegalText(settings.privacy_text),
  };
}

export async function editorState(db: Database): Promise<SiteEditor> {
  const [settings, rows, available] = await Promise.all([
    readSettings(db),
    readCopy(db),
    availableButtons(db),
  ]);
  const order = parseStoredOrder(settings.home_buttons);
  return {
    look: resolveLook(settings),
    name: settings.site_name,
    effective_name: resolveSiteName(settings.site_name),
    copy: editorCopy(rows),
    legal: LEGAL_KINDS.map((kind) => ({
      kind,
      ...editorStartingText(settings[LEGAL_COLUMN[kind]], kind),
    })),
    home: {
      order,
      buttons: resolveButtons(order, available),
      available: [...available.logbooks, ...available.lists, ...available.builtins],
    },
  };
}
