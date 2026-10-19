/**
 * The words on the site's own pages, one slot at a time. Plain text,
 * published exactly as typed in a place the design already put it. Each
 * slot says whether it still carries the shipped wording, so nobody
 * believes they wrote something they did not.
 *
 * What the software says about itself (how a report is sealed, the consent
 * wording, the verify page) is not here and cannot be.
 *
 * INSERT A NUMBER puts a {{ [figure] }} placeholder at the cursor, which the
 * public pages show as that figure (board/figures.ts on the server). A
 * button and a list rather than a menu on right-click: there is no
 * right-click on a phone. The server refuses a placeholder that would not
 * work, and says why, so a broken one never reaches a page as "?".
 */
import { getCopyFigures, setCopy } from '@reportlog/contracts';
import type { CopySlot } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { Select } from '@/components/ui/select.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { call } from '@/lib/api.ts';
import { SaveOutcome, WithEditor, useSave, useUnsavedChanges } from './-editor.tsx';

const figuresQuery = queryOptions({
  queryKey: ['site-editor', 'figures'],
  queryFn: ({ signal }) => call(getCopyFigures, { signal }),
});

/** `text` with `insert` put where the cursor was (or at the end), and where the cursor goes next. */
export function insertAt(
  text: string,
  insert: string,
  at: number | null,
): { text: string; cursor: number } {
  const i = at === null || at < 0 || at > text.length ? text.length : at;
  return { text: text.slice(0, i) + insert + text.slice(i), cursor: i + insert.length };
}

/**
 * The list of figures, asked for only when somebody opens it: most visits
 * to this screen never need it, and it counts every report to answer.
 */
function FigurePicker({ onInsert }: { onInsert: (placeholder: string) => void }) {
  const figures = useQuery(figuresQuery);
  const [chosen, setChosen] = useState('');
  if (figures.isPending) return <p role="status">Loading the figures…</p>;
  if (figures.isError) return <p role="alert">{figures.error.message}</p>;
  const list = figures.data.figures;
  const current = list.find((f) => f.id === chosen);
  const groups = [...new Set(list.map((f) => f.group))];
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line p-3">
      <Field>
        <Label>Which number</Label>
        <Select
          value={chosen}
          onChange={(e) => {
            setChosen(e.target.value);
          }}
        >
          <option value="">Choose one</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {list
                .filter((f) => f.group === g)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
        {current ? (
          <FieldDescription>
            It is {current.value.toLocaleString('en-US')} now. The page shows it while the archive
            is public.
          </FieldDescription>
        ) : null}
      </Field>
      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!current}
          onClick={() => {
            if (current) onInsert(`{{ [${current.id}] }}`);
          }}
        >
          Insert it
        </Button>
      </div>
      <p className="text-sm text-ink-alt">
        It goes in as <code className="font-mono">{'{{ [name] }}'}</code>. Inside the braces you can
        calculate: <code className="font-mono">+ - * /</code>, brackets,{' '}
        <code className="font-mono">round(x, 1)</code> and{' '}
        <code className="font-mono">percent(part, whole)</code>. A number on its own can mislead:
        say what it counts in the words around it.
      </p>
    </div>
  );
}

export const Route = createFileRoute('/(staff)/settings/words')({
  component: () => (
    <Page title="Page wording" lede="What this archive is for, in your own words." width="prose">
      <WithEditor>
        {(state) => (
          <div className="flex flex-col gap-6">
            {state.copy.map((slot) => (
              <SlotEditor key={slot.key} slot={slot} />
            ))}
          </div>
        )}
      </WithEditor>
    </Page>
  ),
});

export function SlotEditor({ slot }: { slot: CopySlot }) {
  const [body, setBody] = useState(slot.body);
  const save = useSave((value: string) =>
    call(setCopy, { params: { key: slot.key }, body: { body: value } }),
  );
  const [picking, setPicking] = useState(false);
  // Only a block takes a number, so only the text area needs its cursor.
  const box = useRef<HTMLTextAreaElement | null>(null);
  // Where the person last left the cursor, or null if they never put it in
  // the box. An untouched box reports a cursor at 0, which would put the
  // number before everything they wrote.
  const cursor = useRef<number | null>(null);
  useUnsavedChanges(slot.label, body !== slot.body);
  const onChange = (e: { target: { value: string } }) => {
    setBody(e.target.value);
  };

  const insert = (placeholder: string) => {
    const next = insertAt(body, placeholder, cursor.current);
    setBody(next.text);
    cursor.current = next.cursor;
    // After React has put the new text in the box.
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{slot.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(body);
          }}
        >
          <Field>
            <Label>{slot.label}</Label>
            <FieldDescription>
              {slot.help} {slot.written ? null : 'This is still the wording the site ships with.'}
            </FieldDescription>
            {slot.kind === 'line' ? (
              <Input value={body} onChange={onChange} />
            ) : (
              <Textarea
                ref={box}
                value={body}
                onChange={onChange}
                onSelect={(e) => {
                  cursor.current = e.currentTarget.selectionStart;
                }}
              />
            )}
          </Field>
          {slot.kind === 'block' ? (
            <div className="flex flex-col gap-2">
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="quiet"
                  aria-expanded={picking}
                  onClick={() => {
                    setPicking(!picking);
                  }}
                >
                  {picking ? 'Hide the numbers' : 'Insert a number'}
                </Button>
              </div>
              {picking ? <FigurePicker onInsert={insert} /> : null}
            </div>
          ) : null}
          <SaveOutcome mutation={save} done="Saved. The page shows it now." />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="secondary" disabled={save.isPending}>
              Save
            </Button>
            {slot.written ? (
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setBody(slot.fallback);
                  save.mutate('');
                }}
              >
                Go back to the shipped wording
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
