/**
 * What the password screen may show: the site's name, the operator's
 * paragraph for it, when the development notice ends (decisions.md §3), and
 * the site's look (decision 60).
 *
 * Read by the lock screen's own call, which is in front of the password
 * (identity/curtainRoutes.ts), so a locked visitor gets these without any
 * other call behind the gate. Nothing else of the site's settings is here on
 * purpose: not the other wording, not a figure.
 */
import type { LockScreenSite, PaintedLook } from '@reportlog/contracts';
import { parseBrand, plainName } from '@reportlog/contracts';
import type { Database } from '../db/database.ts';
import { resolveCopy } from './copy.ts';
import { getDevMode } from './devMode.ts';
import { lookCatalogue } from '../looks/packs.ts';
import { paintedLook } from './look.ts';
import { resolveSiteName } from './identity.ts';
import { readCopy, readSettings } from './settings.ts';

export async function lockScreenSite(db: Database): Promise<LockScreenSite> {
  const [settings, rows] = await Promise.all([readSettings(db), readCopy(db)]);
  const name = resolveSiteName(settings.site_name);
  // Shown as written: never through renderCopy, whose figures are counts of
  // the archive behind the password.
  const intro = resolveCopy(rows).lock_intro;
  return {
    name_parts: parseBrand(name),
    plain_name: plainName(name),
    ...(intro ? { intro } : {}),
  };
}

/** The development notice's end, for the badge on the lock screen and on a door. */
export async function devModeUntil(db: Database): Promise<string | null> {
  return (await getDevMode(db)).until;
}

/**
 * The site's look, for the lock screen and the doors, which never ask
 * /api/site. With the installed packs' stylesheets (decision 60), which
 * `GET /api/looks/*` serves in front of the password: a site wearing a
 * pack's look would otherwise show the default there.
 */
export async function lookInFront(db: Database): Promise<PaintedLook> {
  const [settings, looks] = await Promise.all([readSettings(db), lookCatalogue(db)]);
  return paintedLook(settings, looks);
}
