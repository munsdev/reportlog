/**
 * "Thank you. Have a link? Send it as a tip." (the owner's
 * wording, voting questionnaires §03) shown after a report is filed, and the browser-only carry-over of where and when it happened.
 *
 * NOTHING HERE TELLS THE SERVER WHICH REPORT THE TIP FOLLOWS. The state,
 * county and time are copied from the answers in this browser into this
 * browser's storage when the report is sent, and the tip form reads them
 * there as a head start. The tip filing carries only what the form's own
 * cards hold, so no report reference, thread or token reaches it, and a tip
 * is never connected to a report. localStorage, not sessionStorage, because
 * the confirmation link is usually opened in another tab; it is removed as
 * soon as the tip form has used it and expires with the confirmation link.
 */
import { Button } from '@/components/ui/button.tsx';

const STORAGE_KEY = 'reportlog:tip-prefill';
const KEYS = ['state', 'county', 'time'] as const;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type TipPrefill = Partial<Record<(typeof KEYS)[number], string>>;

export function rememberForTip(answers: Record<string, unknown>): void {
  const out: TipPrefill = {};
  for (const k of KEYS) {
    const v = answers[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  try {
    if (Object.keys(out).length)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), values: out }));
  } catch {
    // Storage may be blocked; the tip form is then simply not pre-filled.
  }
}

/** What the tip form may start with: only questions it has, and only offered choices. */
export function takeTipPrefill(
  fields: readonly { key: string; kind: string; options: readonly string[] }[],
): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { at, values } = parsed as { at?: unknown; values?: unknown };
    if (typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return {};
    }
    const out: Record<string, string> = {};
    for (const f of fields) {
      const v = (values as Record<string, unknown> | null)?.[f.key];
      if (typeof v !== 'string' || !(KEYS as readonly string[]).includes(f.key)) continue;
      if (
        (f.kind === 'choice_one' || f.kind === 'place') &&
        f.options.length &&
        !f.options.includes(v)
      )
        continue;
      out[f.key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function clearTipPrefill(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * The offer under a receipt. A plain link with no query string, no reference
 * and nothing else that could tie the tip to the report: the carry-over is
 * this browser's storage alone. Plain rather than the router's, because it
 * must work in the unit tests' bare render and on a door, and a full page
 * load costs nothing here.
 */
export function TipOffer() {
  return (
    <div className="flex flex-col items-stretch gap-3 sm:items-start">
      <p className="max-w-prose">Thank you. Have a link? Send it as a tip.</p>
      <Button asChild variant="secondary" size="lg" block className="sm:w-auto">
        <a href="/list/tips">Send a link</a>
      </Button>
    </div>
  );
}
