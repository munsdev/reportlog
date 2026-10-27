/**
 * The words on the site's own pages, one slot at a time, grouped by the
 * page each is on. Plain text, published exactly as typed in a place the
 * design already put it. Each slot is a setting panel: closed, its first
 * lines and whether it still carries the shipped wording, so nobody
 * believes they wrote something they did not; open, its editor beside a
 * small picture of where it sits, updating as it is typed (decision 61,
 * instead of editing on the public page).
 *
 * What the software says about itself (how a report is sealed, the consent
 * wording, the verify page) is not here and cannot be.
 *
 * INSERT A NUMBER puts a {{ [figure] }} placeholder at the cursor, which the
 * public pages show as that figure (board/figures.ts on the server). A
 * button and a list rather than a menu on right-click: there is no
 * right-click on a phone. The server refuses a placeholder that would not
 * work, and says why beside the field, so a broken one never reaches a page
 * as "?".
 */
import { getCopyFigures, setCopy } from '@reportlog/contracts';
import type { CopySlot } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Btn } from '@/mockup/StaffBtn.tsx';
import { Field, FieldDescription, FieldError } from '@/mockup/FieldWired.tsx';
import { Input } from '@/mockup/FieldWired.tsx';
import { Label } from '@/mockup/FieldWired.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { Select } from '@/mockup/FieldWired.tsx';
import { useSettingPanels } from '@/mockup/SettingPanel.tsx';
import { Textarea } from '@/mockup/FieldWired.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { GuardedPanel, SettingsFrame } from '../../../features/settings/panels.tsx';
import { SlotInContext, firstLines, groupSlots } from '../../../features/settings/wording.tsx';
import { WithEditor, useSave } from './-editor.tsx';

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
    <div className="panel quiet">
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
      <div className="acts">
        <Btn
          type="button"
          variant="secondary"
          disabled={!current}
          onClick={() => {
            if (current) onInsert(`{{ [${current.id}] }}`);
          }}
        >
          Insert it
        </Btn>
      </div>
      <p className="muted">
        It goes in as <code className="mono">{'{{ [name] }}'}</code>. Inside the braces you can
        calculate: <code className="mono">+ - * /</code>, brackets,{' '}
        <code className="mono">round(x, 1)</code> and{' '}
        <code className="mono">percent(part, whole)</code>. A number on its own can mislead: say
        what it counts in the words around it.
      </p>
    </div>
  );
}

export const Route = createFileRoute('/(staff)/settings/words')({
  component: () => (
    <SettingsFrame>
      <StaffPage
        title="Wording"
        lede="Every piece of text the software ships, grouped by where it appears."
      >
        <WithEditor>{(state) => <WordingList slots={state.copy} />}</WithEditor>
      </StaffPage>
    </SettingsFrame>
  ),
});

export function WordingList({ slots }: { slots: readonly CopySlot[] }) {
  return (
    <>
      {groupSlots(slots).map((group) => (
        <section key={group.page} aria-label={group.page} className="col" style={{ gap: 14 }}>
          <h2 className="h-sec">{group.page}</h2>
          {group.slots.map((slot) => (
            <SlotEditor key={slot.key} slot={slot} />
          ))}
        </section>
      ))}
    </>
  );
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** The figures by id, read only while an open slot has a placeholder to show. */
function useFigureValues(enabled: boolean): ReadonlyMap<string, number> | null {
  const figures = useQuery({ ...figuresQuery, enabled });
  return useMemo(
    () => (figures.data ? new Map(figures.data.figures.map((f) => [f.id, f.value])) : null),
    [figures.data],
  );
}

export function SlotEditor({ slot }: { slot: CopySlot }) {
  const [body, setBody] = useState(slot.body);
  const toast = useToast();
  const panels = useSettingPanels();
  const open = panels.openId === slot.key;
  const save = useSave((value: string) =>
    call(setCopy, { params: { key: slot.key }, body: { body: value } }),
  );
  const [picking, setPicking] = useState(false);
  const figures = useFigureValues(open && body.includes('{{'));
  // Only a block takes a number, so only the text area needs its cursor.
  const box = useRef<HTMLTextAreaElement | null>(null);
  // Where the person last left the cursor, or null if they never put it in
  // the box. An untouched box reports a cursor at 0, which would put the
  // number before everything they wrote.
  const cursor = useRef<number | null>(null);
  const onChange = (e: { target: { value: string } }) => {
    setBody(e.target.value);
  };
  // The mutation's reset is bound once, so the panel keeps one callback.
  const resetSave = save.reset;
  const cancel = useCallback(() => {
    setBody(slot.body);
    setPicking(false);
    resetSave();
  }, [slot.body, resetSave]);

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

  /** Save, and leave the box holding what the server now holds. */
  const write = async (value: string) => {
    const state = await save.mutateAsync(value);
    setBody(state.copy.find((c) => c.key === slot.key)?.body ?? value);
    setPicking(false);
    toast.show(
      value.trim()
        ? `Saved. The page shows it now.`
        : `${slot.label} is back to the shipped wording.`,
    );
    return true;
  };

  const status = slot.written
    ? slot.changed_at
      ? `Changed ${day(slot.changed_at)}`
      : 'Changed'
    : 'Shipped wording';

  return (
    <GuardedPanel
      id={slot.key}
      title={slot.label}
      summary={[
        { key: 'Says', value: firstLines(slot.body) || 'Nothing yet' },
        { key: 'Status', value: status },
      ]}
      dirty={body !== slot.body}
      onCancel={cancel}
      onSave={() => write(body)}
    >
      <div className="grid2 even">
        <div className="form-stack" style={{ maxWidth: 'none' }}>
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
            {/* The server's refusal (a broken placeholder, say), beside the field. */}
            <FieldError>{save.isError ? save.error.message : null}</FieldError>
          </Field>
          {/* The password screen's paragraph takes no numbers (site/copy.ts). */}
          {/* Figures are refused in front of the password and in the emergency notice. */}
          {slot.kind === 'block' && slot.key !== 'lock_intro' && slot.key !== 'help_now' ? (
            <div className="form-stack" style={{ maxWidth: 'none' }}>
              <div className="acts">
                <Btn
                  type="button"
                  variant="quiet"
                  aria-expanded={picking}
                  onClick={() => {
                    setPicking(!picking);
                  }}
                >
                  {picking ? 'Hide the numbers' : 'Insert a number'}
                </Btn>
              </div>
              {picking ? <FigurePicker onInsert={insert} /> : null}
            </div>
          ) : null}
          {slot.written ? (
            <div className="acts">
              <Btn
                type="button"
                variant="quiet"
                onClick={() => {
                  write('').then(
                    () => {
                      panels.closeNow();
                    },
                    // The refusal is shown beside the field; the panel stays open.
                    () => undefined,
                  );
                }}
              >
                Go back to the shipped wording
              </Btn>
            </div>
          ) : null}
        </div>
        <SlotInContext slot={slot} text={body} figures={figures} />
      </div>
    </GuardedPanel>
  );
}
