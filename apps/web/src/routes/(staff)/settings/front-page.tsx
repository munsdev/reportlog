/**
 * Arranging the front page's buttons. The order is the only thing that
 * matters: the first button is the main one and every other is secondary,
 * so there is no colour to choose. A logbook or list may carry its own
 * wording on its button; the site's own buttons keep theirs, because a
 * relabelled "Submit a report" could say something the button does not do.
 *
 * A logbook made after this is saved is still added to the end of the page,
 * so arranging it once never hides a logbook made later.
 */
import { setHomeButtons } from '@reportlog/contracts';
import type { ButtonEntry, SiteEditor } from '@reportlog/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { call } from '@/lib/api.ts';
import { SaveOutcome, WithEditor, useSave } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/front-page')({
  component: () => (
    <Page title="Front page" width="prose">
      <WithEditor>
        {/* Remounted on every save, so the list starts again from what the server now holds. */}
        {(state) => <Arrange key={JSON.stringify(state.home.buttons)} state={state} />}
      </WithEditor>
    </Page>
  ),
});

type Available = SiteEditor['home']['available'][number];
const keyOf = (e: { kind: string; ref: string }) => `${e.kind}:${e.ref}`;

export function Arrange({ state }: { state: SiteEditor }) {
  // Start from what the page shows now, which is the stored order with the
  // append rule already applied.
  const [order, setOrder] = useState<ButtonEntry[]>(() =>
    state.home.buttons.map((b) =>
      b.label !== b.title
        ? { kind: b.kind, ref: b.ref, label: b.label }
        : { kind: b.kind, ref: b.ref },
    ),
  );
  const save = useSave((value: ButtonEntry[] | null) =>
    call(setHomeButtons, { body: { order: value } }),
  );
  const byKey = new Map<string, Available>(state.home.available.map((a) => [keyOf(a), a]));
  const unused = state.home.available.filter((a) => !order.some((e) => keyOf(e) === keyOf(a)));

  const move = (i: number, by: -1 | 1) => {
    const next = [...order];
    const [entry] = next.splice(i, 1);
    if (entry) next.splice(i + by, 0, entry);
    setOrder(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-3" aria-label="Buttons, in order">
        {order.map((entry, i) => {
          const button = byKey.get(keyOf(entry));
          const name = button?.label ?? entry.ref;
          return (
            <li key={keyOf(entry)}>
              <Card className="gap-3 p-4">
                <CardHeader>
                  <CardTitle as="h2" className="text-base">
                    {i === 0 ? (
                      <span className="font-normal text-ink-alt">Main button: </span>
                    ) : null}
                    {name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {entry.kind !== 'builtin' ? (
                    <Field>
                      <Label optional>Wording on the button</Label>
                      <FieldDescription>Left empty, the button says “{name}”.</FieldDescription>
                      <Input
                        value={entry.label ?? ''}
                        onChange={(e) => {
                          const label = e.target.value;
                          setOrder(
                            order.map((o, j) =>
                              j === i
                                ? label
                                  ? { ...o, label }
                                  : { kind: o.kind, ref: o.ref }
                                : o,
                            ),
                          );
                        }}
                      />
                    </Field>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={i === 0}
                      aria-label={`Move ${name} up`}
                      onClick={() => {
                        move(i, -1);
                      }}
                    >
                      Up
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={i === order.length - 1}
                      aria-label={`Move ${name} down`}
                      onClick={() => {
                        move(i, 1);
                      }}
                    >
                      Down
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      aria-label={`Remove ${name}`}
                      onClick={() => {
                        setOrder(order.filter((_, j) => j !== i));
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
      {order.length === 0 ? (
        <p className="text-ink-alt">
          No buttons. Every open logbook will still be added to the front page, so nobody is left
          without a way to file.
        </p>
      ) : null}

      {unused.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-bold">Not on the front page</h2>
          <ul className="flex flex-col gap-2">
            {unused.map((a) => (
              <li key={keyOf(a)} className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Add ${a.label}`}
                  onClick={() => {
                    setOrder([...order, { kind: a.kind, ref: a.ref }]);
                  }}
                >
                  Add
                </Button>
                <span>
                  {a.label}
                  {a.help ? <span className="block text-sm text-ink-alt">{a.help}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SaveOutcome mutation={save} done="The front page shows the new order." />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            save.mutate(order);
          }}
        >
          Save the order
        </Button>
        {state.home.order !== null ? (
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              save.mutate(null);
            }}
          >
            Go back to the shipped order
          </Button>
        ) : null}
      </div>
    </div>
  );
}
