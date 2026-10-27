/**
 * The site's accounts on social media: one row per platform, each with its
 * address and its own switch, so an account can be kept here while it is
 * not shown. What is switched on appears as marks in the footer of every
 * page and, named, in the front page's "Follow us elsewhere" section (which
 * the front page's own editor can hide or move).
 *
 * The address is checked as it is typed, by the same `socialAddress` the
 * server checks with, and the row says the link a handle stands for, so
 * nobody has to guess what "@name" will open. One Save bar for the page.
 */
import {
  SOCIAL_FLOAT_PAGES,
  SOCIAL_FLOAT_PAGE_NAMES,
  SOCIAL_PLACEMENTS,
  SOCIAL_PLACEMENT_NAMES,
  SOCIAL_RULES,
  setSocialLinks,
  socialAddress,
} from '@reportlog/contracts';
import type {
  SiteEditor,
  SocialFloat,
  SocialFloatPage,
  SocialLink,
  SocialPlacement,
  SocialPlatform,
} from '@reportlog/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { CheckOption } from '@/mockup/Choice.tsx';
import { Field, FieldDescription, FieldError, Input, Label } from '@/mockup/Field.tsx';
import { Switch } from '@/mockup/Switch.tsx';
import { SaveBar } from '@/mockup/SaveBar.tsx';
import { SocialIcon } from '@/components/ui/social-icon.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '@/lib/api.ts';
import { SettingsFrame } from '../../../features/settings/panels.tsx';
import { WithEditor, useSave, useUnsavedChanges } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/social')({
  component: () => (
    <SettingsFrame>
      <StaffPage
        title="Social media"
        lede="Your accounts, and where the site shows them. Each account you switch on is shown as a link, with its platform’s mark, in the places you pick below."
      >
        <WithEditor>{(state) => <SocialForm state={state} />}</WithEditor>
      </StaffPage>
    </SettingsFrame>
  ),
});

interface Row {
  id: SocialPlatform;
  address: string;
  shown: boolean;
}

const rowsFrom = (links: readonly SocialLink[]): Row[] =>
  links.map((l) => ({ id: l.id, address: l.url ?? '', shown: l.shown }));

/** Whether a row, as typed, says something different from what is stored. */
function changed(row: Row, stored: SocialLink | undefined): boolean {
  const checked = socialAddress(row.id, row.address);
  const url = checked.ok ? checked.url : row.address;
  return url !== (stored?.url ?? null) || row.shown !== (stored?.shown ?? false);
}

export function SocialForm({ state }: { state: SiteEditor }) {
  const [rows, setRows] = useState(() => rowsFrom(state.social_links));
  const [float, setFloat] = useState<SocialFloat>(state.social_float);
  const [placements, setPlacements] = useState<SocialPlacement[]>(state.social_placements);
  const toast = useToast();
  const save = useSave((body: { links: Row[]; float: SocialFloat; placements: string[] }) =>
    call(setSocialLinks, { body }),
  );
  const stored = new Map(state.social_links.map((l) => [l.id, l]));
  const floatChanged =
    float.on !== state.social_float.on ||
    SOCIAL_FLOAT_PAGES.some(
      (p) => float.pages.includes(p) !== state.social_float.pages.includes(p),
    );
  const placementsChanged = SOCIAL_PLACEMENTS.some(
    (p) => placements.includes(p) !== state.social_placements.includes(p),
  );
  const dirty = floatChanged || placementsChanged || rows.some((r) => changed(r, stored.get(r.id)));
  const problems = rows.filter((r) => !socialAddress(r.id, r.address).ok);
  useUnsavedChanges('the social media accounts', dirty);

  const update = (id: SocialPlatform, change: Partial<Row>) => {
    save.reset();
    setRows((now) => now.map((r) => (r.id === id ? { ...r, ...change } : r)));
  };

  const submit = () => {
    if (problems.length) return;
    save.mutate(
      { links: rows, float, placements },
      {
        onSuccess: (next) => {
          setRows(rowsFrom(next.social_links));
          setFloat(next.social_float);
          setPlacements(next.social_placements);
          const on = next.social_links.filter((l) => l.shown).length;
          toast.show(
            on === 0
              ? 'Saved. No account is shown.'
              : `Saved. ${String(on)} ${on === 1 ? 'account is' : 'accounts are'} shown.`,
          );
        },
      },
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="muted">
        Paste the link to the account, or type its handle (such as @yourname) where the platform has
        them. Visitors leave this site when they follow one, and the platform is not told which page
        they came from.
      </p>
      <Placements
        on={placements}
        onChange={(next) => {
          save.reset();
          setPlacements(next);
        }}
        float={float}
        onFloat={(next) => {
          save.reset();
          setFloat(next);
        }}
      />
      {rows.map((row) => (
        <PlatformRow
          key={row.id}
          row={row}
          onChange={(change) => {
            update(row.id, change);
          }}
        />
      ))}
      {save.isError ? (
        <Note tone="serious" title="That was not saved.">
          {save.error.message}
        </Note>
      ) : null}
      {dirty ? (
        <SaveBar
          name="Social media accounts"
          busy={save.isPending}
          onSave={submit}
          onCancel={() => {
            setRows(rowsFrom(state.social_links));
            setFloat(state.social_float);
            setPlacements(state.social_placements);
            save.reset();
          }}
        />
      ) : null}
    </form>
  );
}

function PlatformRow({ row, onChange }: { row: Row; onChange: (change: Partial<Row>) => void }) {
  const rule = SOCIAL_RULES[row.id];
  const checked = socialAddress(row.id, row.address);
  const url = checked.ok ? checked.url : null;
  return (
    <section className="panel" data-platform={row.id}>
      <h2>
        <SocialIcon platform={row.id} /> {rule.name}
      </h2>
      <Field>
        <Label>Address on {rule.name}</Label>
        <Input
          value={row.address}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            const address = e.target.value;
            // Emptying the address switches it off: there is nothing to show.
            onChange(address.trim() ? { address } : { address, shown: false });
          }}
        />
        <FieldDescription>
          {url ? `Links to ${url.replace(/^https?:\/\//, '')}` : `For example ${rule.example}`}
        </FieldDescription>
        <FieldError>{checked.ok ? null : checked.error}</FieldError>
      </Field>
      <Switch
        label="Show on the site"
        checked={row.shown && !!url}
        disabled={!url}
        onChange={(on) => {
          onChange({ shown: on });
        }}
      />
    </section>
  );
}

/**
 * Where the accounts show. Each place is its own switch, so the site can
 * carry them loudly on the front page and not at all in the footer, or the
 * other way round. A form or a door is not on the list. The floating
 * "Follow us" button is one more switch here; which pages may carry it is a
 * choice among five, and a form or a door is not among them.
 */
function Placements({
  on,
  onChange,
  float,
  onFloat,
}: {
  on: readonly SocialPlacement[];
  onChange: (next: SocialPlacement[]) => void;
  float: SocialFloat;
  onFloat: (next: SocialFloat) => void;
}) {
  const toggle = (page: SocialFloatPage, set: boolean) => {
    onFloat({
      ...float,
      pages: SOCIAL_FLOAT_PAGES.filter((p) => (p === page ? set : float.pages.includes(p))),
    });
  };
  return (
    <section className="panel" data-placements>
      <h2>Where the accounts show</h2>
      {SOCIAL_PLACEMENTS.map((p) => (
        <div key={p} data-placement={p}>
          <Switch
            label={SOCIAL_PLACEMENT_NAMES[p].name}
            help={SOCIAL_PLACEMENT_NAMES[p].where}
            checked={on.includes(p)}
            onChange={(next) => {
              onChange(SOCIAL_PLACEMENTS.filter((q) => (q === p ? next : on.includes(q))));
            }}
          />
        </div>
      ))}
      <div data-float>
        <Switch
          label="Floating “Follow us” button"
          help="A small button in the corner that opens the accounts switched on below. It is never shown on a form or on a page in front of the password."
          checked={float.on}
          onChange={(next) => {
            onFloat({ ...float, on: next });
          }}
        />
      </div>
      {float.on ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          <legend className="lbl">On these pages</legend>
          <div className="choices">
            {SOCIAL_FLOAT_PAGES.map((page) => (
              <CheckOption
                key={page}
                label={SOCIAL_FLOAT_PAGE_NAMES[page]}
                checked={float.pages.includes(page)}
                onCheckedChange={(set) => {
                  toggle(page, set === true);
                }}
              />
            ))}
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}
