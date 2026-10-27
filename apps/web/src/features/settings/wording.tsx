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
  const place = placeOf(slot.key);
  const shown = withFigures(text, figures).trim();
  const empty = !shown;
  return (
    <div className="panel quiet" aria-hidden="true">
      <span className="eyebrow">
        Preview · on the page: {place.page}
        {empty ? ' · empty, so nothing shows here yet' : ''}
      </span>
      <p
        className={place.shape === 'title' ? 'h-page' : undefined}
        style={{
          whiteSpace: 'pre-line',
          ...(place.shape === 'title' ? { fontSize: '1.6rem' } : {}),
        }}
      >
        {shown}
      </p>
    </div>
  );
}
