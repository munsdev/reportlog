/**
 * Arranging the front page's buttons.
 *
 * ONE ROW PER BUTTON, each with a Target drop-down, Main text and Subtext.
 * The target is always something this site owns (a logbook, a list, a public
 * map, one of the site's own pages, or the row of social icons), never an
 * address typed in, so no wording here can send anybody anywhere else. Blank
 * Main text and Subtext mean the target's own wording; the placeholder shows
 * what that is. Every button may be relabelled, the site's own included
 * (decision 76).
 *
 * THE ORDER IS THE EMPHASIS. The first real button is the accent, so there is
 * no colour to choose: to emphasise a different button, move it to the top.
 *
 * A TARGET THAT WOULD NOT DRAW (a closed logbook, a map switched off, a
 * logbook whose own settings say not to show it) keeps its row and is marked
 * "Not showing", with the reason, because deleting it silently would lose the
 * place the operator gave it. The page never draws it.
 *
 * "Remove" takes a button off the page for good: a removed logbook or list is
 * saved as hidden, so a logbook that is open and set to show on the front page
 * is not quietly added back at the end.
 *
 * A phone-width picture of the stack sits beside the list (above it on a
 * phone) and follows every move and every change of wording before it is
 * saved (settings-and-admin.md §10).
 */
import { clearHomeButtons, setHomeButtons } from '@reportlog/contracts';
import type { ArrangementEntry, ButtonTarget, HomeButtonsAdmin } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, buttonVariants } from '../../components/ui/button.tsx';
import { cn } from '../../lib/utils.ts';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { UnsavedChangesGuard, useUnsavedChanges } from '../../routes/(staff)/settings/-editor.tsx';
import { Panel, Problem, Select, TextInput } from './controls.tsx';
import { homeButtonsAdminQuery } from './queries.ts';

export function HomeButtonsEditor() {
  const query = useQuery(homeButtonsAdminQuery());
  // Out here, because the editor below starts again after every save.
  const [notice, setNotice] = useState('');
  return (
    // The same leave-without-saving question the settings screens ask.
    <UnsavedChangesGuard>
      <StaffPage
        title="The front page’s buttons"
        lede="Each row is a button on the front page. Pick where it leads, and say what it says or leave the wording blank. The first button is the main one; to make a different button the main one, move it to the top. Logbooks and lists that are open and set to show on the front page are added at the end by themselves."
      >
        <p>
          <Link to="/logbooks" className="text-sm underline">
            ← All logbooks
          </Link>
        </p>
        {query.isPending && <p role="status">Reading the front page…</p>}
        {query.isError && <Problem error={query.error} />}
        {/* Keyed on what is stored, so a save or a reset starts the editor
          again from what the server now holds. */}
        {query.isSuccess && (
          <Arrange key={JSON.stringify(query.data.stored)} data={query.data} onDone={setNotice} />
        )}
        {notice && <p role="status">{notice}</p>}
      </StaffPage>
    </UnsavedChangesGuard>
  );
}

/** A row as the editor holds it. `target` is `kind:ref`, or '' for a row not yet pointed at anything. */
interface Row {
  id: number;
  target: string;
  label: string;
  sub: string;
}

const keyOf = (t: { kind: string; ref: string }) => `${t.kind}:${t.ref}`;

/** The drop-down's groups, in the order an operator looks for things. */
const GROUPS: { kind: ButtonTarget['kind']; heading: string }[] = [
  { kind: 'logbook', heading: 'Logbooks' },
  { kind: 'list', heading: 'Lists' },
  { kind: 'map', heading: 'Maps' },
  { kind: 'builtin', heading: 'Pages' },
  { kind: 'social', heading: 'Social links' },
];

const startRows = (data: HomeButtonsAdmin): Row[] =>
  data.rows.map((r, i) => ({
    id: i,
    target: keyOf(r),
    label: r.label ?? '',
    sub: r.sub ?? '',
  }));

/** What a row says about itself when its boxes are blank. */
const forSave = (rows: readonly Row[]) =>
  rows.map((r) => `${r.target}|${r.label.trim()}|${r.sub.trim()}`).join('\n');

function Arrange({ data, onDone }: { data: HomeButtonsAdmin; onDone: (notice: string) => void }) {
  const qc = useQueryClient();
  const targets = new Map(data.targets.map((t) => [keyOf(t), t]));
  const [rows, setRows] = useState<Row[]>(() => startRows(data));
  const [next, setNext] = useState(rows.length);
  // The editor starts again after every save (see the key above), so what the
  // server holds is always what `data` shows.
  const initial = forSave(startRows(data));
  useUnsavedChanges('the front page’s buttons', forSave(rows) !== initial);
  const done = (notice: string) => (result: HomeButtonsAdmin) => {
    qc.setQueryData(homeButtonsAdminQuery().queryKey, result);
    onDone(notice);
  };
  const unfinished = rows.some((r) => !r.target);
  const save = useMutation({
    mutationFn: () => {
      const placed = new Set(rows.map((r) => r.target));
      const order: ArrangementEntry[] = [
        ...rows.map((r) => {
          const [kind = '', ...rest] = r.target.split(':');
          return {
            kind,
            ref: rest.join(':'),
            ...(r.label.trim() ? { label: r.label.trim() } : {}),
            ...(r.sub.trim() ? { sub: r.sub.trim() } : {}),
          };
        }),
        // HIDDEN, SAID SO. Left out, a logbook or list is "new" to the server
        // and is added back to the end of the page.
        ...data.targets
          .filter((t) => (t.kind === 'logbook' || t.kind === 'list') && !placed.has(keyOf(t)))
          .map((t) => ({ kind: t.kind, ref: t.ref, hidden: true as const })),
      ];
      return call(setHomeButtons, { body: { order } });
    },
    onSuccess: done('Saved.'),
  });
  const reset = useMutation({
    mutationFn: () => call(clearHomeButtons),
    onSuccess: done('Back to the standard order.'),
  });

  const move = (i: number, by: -1 | 1) => {
    setRows((now) => {
      const list = [...now];
      const [r] = list.splice(i, 1);
      if (r) list.splice(i + by, 0, r);
      return list;
    });
  };
  const change = (i: number, patch: Partial<Row>) => {
    setRows((now) => now.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };

  /** What the button will say, and whether it will draw. */
  const read = (r: Row) => {
    const t = targets.get(r.target);
    return {
      t,
      main: r.label.trim() || t?.label || '',
      second: r.sub.trim() || t?.blurb || '',
    };
  };
  const drawn = rows.filter((r) => targets.get(r.target)?.showing);
  const firstReal = drawn.find((r) => targets.get(r.target)?.kind !== 'social');

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Above the list on a phone, beside it on a desktop. */}
      <FrontPagePreview
        className="lg:order-2 lg:sticky lg:top-24"
        buttons={drawn.map((r) => ({
          key: String(r.id),
          label: read(r).main,
          icons: targets.get(r.target)?.kind === 'social',
          accent: r === firstReal,
        }))}
      />
      <div className="flex flex-col gap-6 lg:order-1">
        <Panel title="In this order">
          {rows.length === 0 && <p>No buttons. Open logbooks are still added to the page.</p>}
          <ol className="space-y-3" aria-label="Buttons, in order">
            {rows.map((r, i) => {
              const { t, main, second } = read(r);
              const name = main || 'New button';
              const taken = new Set(rows.filter((x) => x !== r).map((x) => x.target));
              return (
                <li key={r.id} className="space-y-3 rounded-card border border-line p-3">
                  <p className="font-semibold">
                    {name}
                    {r === firstReal && (
                      <span className="ml-2 text-sm font-normal">(the main button)</span>
                    )}
                  </p>
                  {t && !t.showing && (
                    <p className="text-sm font-semibold">
                      Not showing{t.why_not ? `: ${t.why_not}` : '.'}
                    </p>
                  )}
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`target-${String(r.id)}`} className="text-sm font-semibold">
                      Target
                    </label>
                    <Select
                      id={`target-${String(r.id)}`}
                      value={r.target}
                      onChange={(e) => {
                        change(i, { target: e.target.value });
                      }}
                    >
                      {!r.target && <option value="">Choose where it leads…</option>}
                      {GROUPS.map((g) => {
                        const inGroup = data.targets.filter((x) => x.kind === g.kind);
                        if (!inGroup.length) return null;
                        return (
                          <optgroup key={g.kind} label={g.heading}>
                            {inGroup.map((x) => (
                              <option
                                key={keyOf(x)}
                                value={keyOf(x)}
                                disabled={taken.has(keyOf(x))}
                              >
                                {x.label}
                                {x.showing ? '' : ' (not showing)'}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </Select>
                    {t?.help && <p className="text-sm text-muted">{t.help}</p>}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`main-${String(r.id)}`} className="text-sm font-semibold">
                        Main text
                      </label>
                      <TextInput
                        id={`main-${String(r.id)}`}
                        value={r.label}
                        maxLength={80}
                        placeholder={t?.label ?? ''}
                        onChange={(e) => {
                          change(i, { label: e.target.value });
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`sub-${String(r.id)}`} className="text-sm font-semibold">
                        Subtext
                      </label>
                      <TextInput
                        id={`sub-${String(r.id)}`}
                        value={r.sub}
                        maxLength={160}
                        placeholder={t?.blurb ?? 'None'}
                        onChange={(e) => {
                          change(i, { sub: e.target.value });
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-muted">
                    Left blank, the button says what the target says
                    {second || !t ? '' : ', and has no second line'}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={i === 0}
                      aria-label={`Move up: “${name}”`}
                      onClick={() => {
                        move(i, -1);
                      }}
                    >
                      Move up
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={i === rows.length - 1}
                      aria-label={`Move down: “${name}”`}
                      onClick={() => {
                        move(i, 1);
                      }}
                    >
                      Move down
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={`Remove: “${name}”`}
                      onClick={() => {
                        setRows((now) => now.filter((_, j) => j !== i));
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setRows((now) => [...now, { id: next, target: '', label: '', sub: '' }]);
                setNext((n) => n + 1);
              }}
            >
              Add a button
            </Button>
          </div>
          {unfinished && <p className="text-sm">Choose a target for every button before saving.</p>}
          <Problem error={save.error ?? reset.error} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={save.isPending || unfinished}
              onClick={() => {
                save.mutate();
              }}
            >
              Save this order
            </Button>
            <Button
              variant="secondary"
              disabled={reset.isPending}
              onClick={() => {
                reset.mutate();
              }}
            >
              Go back to the standard order
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/**
 * The front page's buttons as a phone shows them, in the site's own look:
 * the first one the main (primary) button, the rest secondary, each the
 * width of the screen; the social links a row of marks. It follows the list
 * as it is changed, before anything is saved, and leaves out what would not
 * draw. A picture: hidden from screen readers, with the list beside it
 * saying the same in words.
 */
function FrontPagePreview({
  buttons,
  className,
}: {
  buttons: readonly {
    key: string;
    label: string;
    icons: boolean;
    accent: boolean;
  }[];
  className?: string;
}) {
  return (
    <figure className={cn('m-0 flex flex-col gap-2', className)}>
      <figcaption className="label-face text-xs text-ink-alt">
        On a phone, as it will look
      </figcaption>
      <div
        aria-hidden="true"
        className="flex w-full max-w-[20rem] flex-col gap-3 rounded-[18px] border-2 border-ink bg-paper p-4"
      >
        {buttons.length === 0 ? (
          <span className="text-sm text-ink-alt">No buttons.</span>
        ) : (
          buttons.map((b) =>
            b.icons ? (
              <span key={b.key} className="text-center text-sm text-ink-alt">
                {b.label}: ● ● ●
              </span>
            ) : (
              <span
                key={b.key}
                className={buttonVariants({
                  variant: b.accent ? 'primary' : 'secondary',
                  block: true,
                })}
              >
                {b.label}
              </span>
            ),
          )
        )}
      </div>
    </figure>
  );
}
