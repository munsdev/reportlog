/**
 * Where each piece of page wording appears, and a small picture of it there
 * (settings-and-admin.md §05, decision 61). The Wording page edits text in a
 * form, never on the public page; this shows the slot in context beside its
 * editor instead, in the site's look, updating as it is typed.
 *
 * ONE MINIATURE PER KIND OF PLACE, not one per page section: a title, the
 * line under a title, a paragraph, a notice. The design leaves which
 * sections need their own miniature open (§14); these four cover every slot
 * the server offers today, and a slot this file does not know is shown as a
 * paragraph under "Other". Placeholders show as their figure now, when the
 * figures have been read, or as "#" until then.
 */
import type { CopySlot, LegalKind } from '@reportlog/contracts';
import { BrandName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow } from '@/components/ui/type.tsx';
import { cn } from '@/lib/utils.ts';

/** The two legal notices, by the names the settings use. */
export const LEGAL_TITLES: Record<LegalKind, string> = {
  impressum: 'Imprint',
  privacy: 'Privacy policy',
};

type Shape = 'title' | 'lede' | 'text' | 'notice';

/** The page a slot is on, in the words of the site's own menu, and its shape there. */
const PLACES: Record<string, { page: string; shape: Shape }> = {
  home_headline: { page: 'Front page', shape: 'title' },
  home_lede: { page: 'Front page', shape: 'lede' },
  home_intro: { page: 'Front page', shape: 'text' },
  about_archive: { page: 'About', shape: 'text' },
  submit_intro: { page: 'Filing a report', shape: 'text' },
  submit_question: { page: 'Filing a report', shape: 'lede' },
  send_note: { page: 'Filing a report', shape: 'notice' },
  refusal_message: { page: 'Filing a report', shape: 'notice' },
  intake_paused_notice: { page: 'Filing a report', shape: 'notice' },
  origin_open_form: { page: 'Filing a report', shape: 'text' },
  origin_organization: { page: 'Filing a report', shape: 'text' },
  board_intro: { page: 'Board', shape: 'text' },
  how_intro: { page: 'How to use this', shape: 'text' },
  alliance_intro: { page: 'Participating organizations', shape: 'text' },
  standards: { page: 'Moderation standard', shape: 'text' },
  lock_intro: { page: 'Password screen', shape: 'text' },
  terms_of_use: { page: 'Terms of use', shape: 'text' },
  contact_users: { page: 'Contact', shape: 'text' },
  contact_authorities: { page: 'Contact', shape: 'text' },
};

export function placeOf(key: string): { page: string; shape: Shape } {
  return PLACES[key] ?? { page: 'Other', shape: 'text' };
}

/** The pages, in the order the Wording page lists them. */
export function groupSlots(slots: readonly CopySlot[]): { page: string; slots: CopySlot[] }[] {
  const groups: { page: string; slots: CopySlot[] }[] = [];
  for (const slot of slots) {
    const { page } = placeOf(slot.key);
    let group = groups.find((g) => g.page === page);
    if (!group) {
      group = { page, slots: [] };
      groups.push(group);
    }
    group.slots.push(slot);
  }
  return groups;
}

const PLACEHOLDER = /\{\{\s*([^}]*?)\s*\}\}/g;

/** The text as a page would show it: each simple placeholder as its figure, anything else as "#". */
export function withFigures(text: string, figures: ReadonlyMap<string, number> | null): string {
  return text.replace(PLACEHOLDER, (_all, inner: string) => {
    const simple = /^\[([^\]]+)\]$/.exec(inner.trim());
    const value = simple?.[1] ? figures?.get(simple[1]) : undefined;
    return value === undefined ? '#' : value.toLocaleString('en-US');
  });
}

/** The first two lines of a slot's text, for its closed panel. */
export function firstLines(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim());
  const two = lines.slice(0, 2).join(' ');
  return lines.length > 2 || two.length > 160 ? `${two.slice(0, 160).trimEnd()}…` : two;
}

/**
 * The slot where it sits, drawn small in the site's look. Hidden from
 * screen readers: the field beside it holds the same words.
 */
export function SlotInContext({
  slot,
  text,
  figures,
}: {
  slot: CopySlot;
  text: string;
  figures: ReadonlyMap<string, number> | null;
}) {
  const site = useSite();
  const place = placeOf(slot.key);
  const shown = withFigures(text, figures).trim();
  const empty = !shown;
  const words = (
    <span
      className={cn(
        'block whitespace-pre-line',
        empty && 'min-h-10 rounded-control border-2 border-dashed border-ink-alt',
      )}
    >
      {shown}
    </span>
  );
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="label-face text-xs text-ink-alt">
        On the page: {place.page}
        {empty ? ' · empty, so nothing shows here yet' : ''}
      </figcaption>
      <div
        aria-hidden="true"
        className="flex flex-col gap-2 overflow-hidden rounded-card border-2 border-ink bg-paper p-4 text-sm"
      >
        <Eyebrow>{site.data ? <BrandName parts={site.data.name_parts} /> : 'ReportLog'}</Eyebrow>
        {place.shape === 'title' ? (
          <span className="font-display text-2xl font-bold">{words}</span>
        ) : (
          <span className="font-display text-xl font-bold">{place.page}</span>
        )}
        {place.shape === 'lede' ? <span className="text-ink-alt">{words}</span> : null}
        {place.shape === 'text' ? words : null}
        {place.shape === 'notice' ? (
          <span className="block rounded-card bg-paper-alt p-3">{words}</span>
        ) : null}
      </div>
    </figure>
  );
}
