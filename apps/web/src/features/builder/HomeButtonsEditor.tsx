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
import { useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { Panel as MPanel } from '@/mockup/Panel.tsx';
import { FrontPageTabs } from './FrontPageTabs.tsx';
import { OnTheFrontPage } from './OnTheFrontPage.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { UnsavedChangesGuard, useUnsavedChanges } from '../../routes/(staff)/settings/-editor.tsx';
import { Field, Problem, Select, TextInput } from './controls.tsx';
import { homeButtonsAdminQuery } from './queries.ts';

export function HomeButtonsEditor() {
  const query = useQuery(homeButtonsAdminQuery());
  // Out here, because the editor below starts again after every save.
  const [notice, setNotice] = useState('');
  return (
    // The same leave-without-saving question the settings screens ask.
    <UnsavedChangesGuard>
      <StaffPage
        title="Front page and pages"
        tabs={<FrontPageTabs current="buttons" />}
        lede="What the front page’s buttons lead to, and their order. The first is the main one. Logbooks and lists that are open and switched on here are added at the end by themselves."
      >
        <OnTheFrontPage />
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

/** What kind of thing a button points at, for its line. */
const kindWords = (kind: string) =>
  kind === 'builtin' ? 'Built in' : kind.charAt(0).toUpperCase() + kind.slice(1);

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
      main: r.label.trim() === '' ? (t?.label ?? '') : r.label.trim(),
      second: r.sub.trim() === '' ? (t?.blurb ?? '') : r.sub.trim(),
    };
  };
  const drawn = rows.filter((r) => targets.get(r.target)?.showing);
  const firstReal = drawn.find((r) => targets.get(r.target)?.kind !== 'social');

  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div className="grid2">
      <div className="col">
        <MPanel title="The big buttons, in this order">
          {rows.length === 0 && <p>No buttons. Open logbooks are still added to the page.</p>}
          <div className="qlist" role="list" aria-label="Buttons, in order">
            {rows.map((r, i) => {
              const { t, main, second } = read(r);
              const name = main || 'New button';
              const taken = new Set(rows.filter((x) => x !== r).map((x) => x.target));
              const open = editing === r.id || !r.target;
              return (
                <div key={r.id} role="listitem" style={{ display: 'contents' }}>
                  <div className="qitem">
                    <span className="h" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div>
                      <b>{name}</b>
                      <small>
                        {t ? `${kindWords(t.kind)} · ${t.label}` : 'Not yet pointed anywhere'}
                        {r === firstReal ? ' · highlighted' : ''}
                      </small>
                      {t && !t.showing && (
                        <small>Not showing{t.why_not ? `: ${t.why_not}` : '.'}</small>
                      )}
                    </div>
                    <div className="acts">
                      <Btn
                        look="ghost"
                        sm
                        flat

                        disabled={i === 0}
                        aria-label={`Move up: “${name}”`}
                        onClick={() => {
                          move(i, -1);
                        }}
                      >
                        ↑
                      </Btn>
                      <Btn
                        look="ghost"
                        sm
                        flat

                        disabled={i === rows.length - 1}
                        aria-label={`Move down: “${name}”`}
                        onClick={() => {
                          move(i, 1);
                        }}
                      >
                        ↓
                      </Btn>
                      <Btn
                        sm
                        flat

                        aria-label={`Change: “${name}”`}
                        aria-expanded={open}
                        onClick={() => {
                          setEditing(open && r.target ? null : r.id);
                        }}
                      >
                        Change
                      </Btn>
                      <Btn
                        look="ghost"
                        sm
                        flat

                        aria-label={`Remove: “${name}”`}
                        onClick={() => {
                          setRows((now) => now.filter((_, j) => j !== i));
                        }}
                      >
                        Remove
                      </Btn>
                    </div>
                  </div>
                  {open && (
                    <MPanel kind="quiet">
                      <Field label="Target" help={t?.help ?? undefined}>
                        {(p) => (
                          <Select
                            {...p}
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
                        )}
                      </Field>
                      <div className="grid2 even">
                        <Field label="Main text">
                          {(p) => (
                            <TextInput
                              {...p}
                              value={r.label}
                              maxLength={80}
                              placeholder={t?.label ?? ''}
                              onChange={(e) => {
                                change(i, { label: e.target.value });
                              }}
                            />
                          )}
                        </Field>
                        <Field label="Subtext">
                          {(p) => (
                            <TextInput
                              {...p}
                              value={r.sub}
                              maxLength={160}
                              placeholder={t?.blurb ?? 'None'}
                              onChange={(e) => {
                                change(i, { sub: e.target.value });
                              }}
                            />
                          )}
                        </Field>
                      </div>
                      <p className="muted">
                        Left blank, the button says what the target says
                        {second || !t ? '' : ', and has no second line'}.
                      </p>
                    </MPanel>
                  )}
                </div>
              );
            })}
          </div>
          {unfinished && <p>Choose a target for every button before saving.</p>}
          <Problem error={save.error ?? reset.error} />
          <div className="acts">
            <Btn
              sm
              flat

              onClick={() => {
                setRows((now) => [...now, { id: next, target: '', label: '', sub: '' }]);
                // Open for wording: choosing its target must not close it.
                setEditing(next);
                setNext((n) => n + 1);
              }}
            >
              Add a button
            </Btn>
            <Btn
              look="ink"
              sm
              flat

              disabled={save.isPending || unfinished}
              onClick={() => {
                save.mutate();
              }}
            >
              Save this order
            </Btn>
            <Btn
              look="ghost"
              sm
              flat

              disabled={reset.isPending}
              onClick={() => {
                reset.mutate();
              }}
            >
              Go back to the standard order
            </Btn>
          </div>
          <p className="muted">
            Each button points at a logbook, list, map, page or the social links. Its words come
            from the target unless you write your own. A closed target hides its button and says why
            here.
          </p>
        </MPanel>
      </div>
      <div className="col">
        <FrontPagePreview
          buttons={drawn.map((r) => ({
            key: String(r.id),
            label: read(r).main,
            icons: targets.get(r.target)?.kind === 'social',
            accent: r === firstReal,
          }))}
        />
      </div>
    </div>
  );
}

/**
 * The front page's buttons as a phone shows them (the mock-up's
 * `phone-prev`): the first one the main button, the rest plain, social links
 * a row of marks. It follows the list as it is changed, before anything is
 * saved, and leaves out what would not draw. A picture: hidden from screen
 * readers, with the list beside it saying the same in words.
 */
function FrontPagePreview({
  buttons,
}: {
  buttons: readonly {
    key: string;
    label: string;
    icons: boolean;
    accent: boolean;
  }[];
}) {
  return (
    <div className="phone-prev">
      <span className="eyebrow">On a phone, as it will look</span>
      <div className="pp" aria-hidden="true">
        {buttons.length === 0 ? (
          <span className="muted">No buttons.</span>
        ) : (
          buttons.map((b) =>
            b.icons ? (
              <span key={b.key} className="muted">
                {b.label}: ● ● ●
              </span>
            ) : (
              <span key={b.key} className={b.accent ? 'ppb go' : 'ppb'}>
                {b.label}
              </span>
            ),
          )
        )}
      </div>
    </div>
  );
}
