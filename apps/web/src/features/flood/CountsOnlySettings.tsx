/**
 * "Publish as counts only", per logbook (Plan E, PE3). An administrator's
 * setting: its accepted reports are counted on every count, map and figure,
 * and shown as an entry nowhere. Each change is a public switch use.
 *
 * Beside it, the logbook's SMALL-AREA THRESHOLD (PE4): while it is counts
 * only, a place with fewer accepted reports than this is published as a
 * name with no number, on the counts, the numbers, the public API and any
 * heat map reading it. Each change is a public switch use too.
 */
import {
  SMALL_AREA_DEFAULT,
  SMALL_AREA_FLOOR,
  listCountsOnly,
  setCountsOnly,
  setSmallArea,
} from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Note } from '@/mockup/NoteBox.tsx';
import { Btn } from '@/mockup/StaffBtn.tsx';
import { Panel } from '@/mockup/PanelBox.tsx';
import { CheckOption } from '@/mockup/Choices.tsx';
import { Field, FieldDescription, FieldError } from '@/mockup/FieldWired.tsx';
import { Input } from '@/mockup/FieldWired.tsx';
import { Label } from '@/mockup/FieldWired.tsx';
import { call } from '../../lib/api.ts';

const countsOnlyQuery = queryOptions({
  queryKey: ['moderation', 'counts-only'],
  queryFn: ({ signal }) => call(listCountsOnly, { signal }),
});

export function CountsOnlySettings() {
  const qc = useQueryClient();
  const query = useQuery(countsOnlyQuery);
  const set = useMutation({
    mutationFn: (v: { slug: string; counts_only: boolean }) =>
      call(setCountsOnly, { params: { slug: v.slug }, body: { counts_only: v.counts_only } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  if (!query.data) return null;
  return (
    <Panel heading="Publish as counts only">
      <p className="muted">
        A logbook published as counts only shows its accepted reports as counts by place and time,
        and never one by one: not on the board, a report’s page, the spreadsheet, the chain file,
        the daily snapshot or a digest. Every change, the threshold included, is recorded as a
        public switch use and shown publicly with its time.
      </p>
      {query.data.logbooks.length === 0 ? <p>No logbook has launched yet.</p> : null}
      <div className="choices">
        {query.data.logbooks.map((l) => (
          <div key={l.slug} className="form-stack">
            <CheckOption
              id={`counts-${l.slug}`}
              label={`${l.title} is published as counts only`}
              checked={l.counts_only}
              disabled={set.isPending}
              onCheckedChange={(v) => {
                set.mutate({ slug: l.slug, counts_only: v === true });
              }}
            />
            <SmallArea slug={l.slug} title={l.title} saved={l.small_area} />
          </div>
        ))}
      </div>
      {set.error ? <Note tone="serious">{set.error.message}</Note> : null}
    </Panel>
  );
}

/** One logbook's threshold: typed, then saved with a button, never on each keystroke. */
function SmallArea({ slug, title, saved }: { slug: string; title: string; saved: number }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(String(saved));
  const [done, setDone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (n: number) => call(setSmallArea, { params: { slug }, body: { small_area: n } }),
    onSuccess: async (d) => {
      setDone(
        `Saved. Places with fewer than ${String(d.small_area)} are counted without a number.`,
      );
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  return (
    <form
      aria-label={`The small-area threshold for ${title}`}
      // The server's sentence, beside the field, not the browser's bubble.
      noValidate
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(null);
        save.mutate(Number(value));
      }}
    >
      <Field>
        <Label>{`Smallest place count published for ${title}`}</Label>
        <FieldDescription>
          While this logbook is counts only, a place (a state, a county, any location answer) with
          fewer accepted reports than this is listed by name with no number, on every public count
          and on any heat map that reads it. The least is {SMALL_AREA_FLOOR}; the usual is{' '}
          {SMALL_AREA_DEFAULT}. At 1, every place is counted from its first report; at 2, a place
          listed without a number holds one report; a higher number says less about it. With only
          one such place, the logbook’s total minus the places shown still gives its count.
        </FieldDescription>
        <Input
          type="number"
          inputMode="numeric"
          min={SMALL_AREA_FLOOR}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDone(null);
          }}
          className="max-w-32"
        />
        <FieldError>{save.error ? save.error.message : null}</FieldError>
      </Field>
      <div>
        <Btn type="submit" variant="secondary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save the threshold'}
        </Btn>
      </div>
      {done ? <p role="status">{done}</p> : null}
    </form>
  );
}
