/**
 * Arranging the front page's buttons.
 *
 * THE ORDER IS THE WHOLE SETTING. The first button is the accent, so there is
 * no colour to choose: to emphasise a different button, move it to the top.
 * A label is optional; left empty, a button wears its logbook's own title.
 *
 * What is shown as "on the page now" comes from the server, which also
 * appends any logbook nobody has placed yet, so a logbook made after this
 * page was arranged still appears.
 */
import { clearHomeButtons, setHomeButtons } from '@reportlog/contracts';
import type { ArrangementEntry, AvailableButton, HomeButtonsAdmin } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { UnsavedChangesGuard, useUnsavedChanges } from '../../routes/(staff)/settings/-editor.tsx';
import { Panel, Problem, TextInput } from './controls.tsx';
import { homeButtonsAdminQuery } from './queries.ts';

export function HomeButtonsEditor() {
  const query = useQuery(homeButtonsAdminQuery());
  // Out here, because the editor below starts again after every save.
  const [notice, setNotice] = useState('');
  return (
    // The same leave-without-saving question the settings screens ask.
    <UnsavedChangesGuard>
      <div className="space-y-6">
        <header className="space-y-2">
          <Link to="/logbooks" className="text-sm underline">
            ← All logbooks
          </Link>
          <h1 className="font-display text-title font-bold">The front page’s buttons</h1>
          <p className="max-w-prose text-ink-alt">
            Every open logbook is a button on the front page. The first button is the main one; to
            make a different button the main one, move it to the top.
          </p>
        </header>
        {query.isPending && <p role="status">Reading the front page…</p>}
        {query.isError && <Problem error={query.error} />}
        {/* Keyed on what is stored, so a save or a reset starts the editor
          again from what the server now holds. */}
        {query.isSuccess && (
          <Arrange key={JSON.stringify(query.data.stored)} data={query.data} onDone={setNotice} />
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </UnsavedChangesGuard>
  );
}

type Row = ArrangementEntry & { label: string };

const shown = (data: HomeButtonsAdmin): Row[] =>
  data.buttons.map((b) => ({
    kind: b.kind,
    ref: b.ref,
    label: b.label === b.title ? '' : b.label,
  }));

function Arrange({ data, onDone }: { data: HomeButtonsAdmin; onDone: (notice: string) => void }) {
  const qc = useQueryClient();
  const all: AvailableButton[] = [
    ...data.available.logbooks,
    ...data.available.lists,
    ...data.available.builtins,
  ];
  const find = (r: { kind: string; ref: string }) =>
    all.find((b) => b.kind === r.kind && b.ref === r.ref);
  // Start from what the page shows now: that is the arrangement to change.
  const [rows, setRows] = useState<Row[]>(() => shown(data));
  // The editor starts again after every save (see the key above), so what
  // the server holds is always what `data` shows.
  useUnsavedChanges(
    'the front page’s buttons',
    JSON.stringify(rows) !== JSON.stringify(shown(data)),
  );
  const done = (notice: string) => (next: HomeButtonsAdmin) => {
    qc.setQueryData(homeButtonsAdminQuery().queryKey, next);
    onDone(notice);
  };
  const save = useMutation({
    mutationFn: () =>
      call(setHomeButtons, {
        body: { order: rows.map((r) => (r.label.trim() ? r : { kind: r.kind, ref: r.ref })) },
      }),
    onSuccess: done('Saved.'),
  });
  const reset = useMutation({
    mutationFn: () => call(clearHomeButtons),
    onSuccess: done('Back to the standard order.'),
  });

  const move = (i: number, by: -1 | 1) => {
    setRows((now) => {
      const next = [...now];
      const [r] = next.splice(i, 1);
      if (r) next.splice(i + by, 0, r);
      return next;
    });
  };
  const missing = all.filter((b) => !rows.some((r) => r.kind === b.kind && r.ref === b.ref));

  return (
    <>
      <Panel title="In this order">
        {rows.length === 0 && <p>No buttons. Open logbooks are still added to the page.</p>}
        <ol className="space-y-3" aria-label="Buttons, in order">
          {rows.map((r, i) => {
            const b = find(r);
            const name = b?.label ?? r.ref;
            return (
              <li
                key={`${r.kind}:${r.ref}`}
                className="space-y-2 rounded-card border border-line p-3"
              >
                <p className="font-semibold">
                  {name}
                  {i === 0 && <span className="ml-2 text-sm font-normal">(the main button)</span>}
                </p>
                <p className="text-sm text-muted">
                  {r.kind === 'builtin'
                    ? 'Part of the site'
                    : r.kind === 'list'
                      ? 'A list'
                      : 'A logbook'}
                  {b?.help ? `. ${b.help}` : ''}
                </p>
                {r.kind !== 'builtin' && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`label-${r.kind}-${r.ref}`} className="text-sm font-semibold">
                      Button wording (optional)
                    </label>
                    <TextInput
                      id={`label-${r.kind}-${r.ref}`}
                      value={r.label}
                      maxLength={80}
                      placeholder={name}
                      onChange={(e) => {
                        const label = e.target.value;
                        setRows((now) => now.map((x, j) => (j === i ? { ...x, label } : x)));
                      }}
                    />
                  </div>
                )}
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
                    aria-label={`Take off the page: “${name}”`}
                    onClick={() => {
                      setRows((now) => now.filter((_, j) => j !== i));
                    }}
                  >
                    Take off the page
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        <Problem error={save.error ?? reset.error} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={save.isPending}
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

      {missing.length > 0 && (
        <Panel title="Not on the page">
          <ul className="space-y-2">
            {missing.map((b) => (
              <li
                key={`${b.kind}:${b.ref}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>{b.label}</span>
                <Button
                 
                  variant="secondary"
                  aria-label={`Add to the page: “${b.label}”`}
                  onClick={() => {
                    setRows((now) => [...now, { kind: b.kind, ref: b.ref, label: '' }]);
                  }}
                >
                  Add to the page
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
