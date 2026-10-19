/**
 * What this deployment calls itself: what an administrator set, or failing
 * that the software's own name. The software is still called ReportLog and
 * the footer says so; a deployment naming itself is not a deployment
 * claiming to have written this.
 *
 * Legacy also read a SITE_NAME from the environment between the two. That
 * belonged to its installer; nothing here reads the environment (only
 * config.ts does), and an operator names the site in the settings screen.
 */
import { MAX_SITE_NAME, SOFTWARE_NAME, accentMarksClose, plainName } from '@reportlog/contracts';
import type { Checked } from './result.ts';

export function resolveSiteName(stored: string | null | undefined): string {
  const name = typeof stored === 'string' ? stored.trim() : '';
  return name || SOFTWARE_NAME;
}

/** Null clears the name, which goes back to the software's. */
export function validateSiteName(raw: string | null): Checked<string | null> {
  if (raw === null) return { ok: true, value: null };
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  // Measured on the name, not the markup: two quote marks should not cost
  // an operator two characters of their own title.
  if (plainName(value).length > MAX_SITE_NAME) {
    return { ok: false, error: `Keep the name under ${String(MAX_SITE_NAME)} characters.` };
  }
  if (!plainName(value).trim()) return { ok: false, error: 'The name needs some letters in it.' };
  // An unclosed double quote is a typo, and saying so while typing beats
  // finding it on the page. A single one is an apostrophe and is left alone.
  if (!accentMarksClose(value)) {
    return {
      ok: false,
      error:
        'Close the quotes, or leave them out. A pair of double quotes marks part of the name in the accent colour.',
    };
  }
  return { ok: true, value };
}
