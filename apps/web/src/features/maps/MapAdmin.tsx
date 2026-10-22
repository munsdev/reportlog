/**
 * Making and arranging heat maps. Ported from legacy public/js/admin-maps.js.
 *
 * Two things an operator decides, in the order they need them:
 *
 *   1. Which question places a report, per logbook (and per list). A logbook
 *      with no location question is listed anyway, with the reason it cannot
 *      be mapped: an operator looking for it should find it.
 *   2. The maps: as many as wanted, each off until turned on, each with its
 *      own threshold, feeds and slot, in the order they appear.
 *
 * The server refuses every setting that would draw an empty map, in words;
 * this screen shows those words beside the setting. What a reader sees is
 * decided by the server alone, so nothing here can publish a number the
 * threshold withholds: the preview is computed by the same code.
 */
import {
  DEFAULT_MIN_AREA,
  MIN_AREA_FLOOR,
  arrangeHeatMaps,
  createHeatMap,
  deleteHeatMap,
  previewHeatMap,
  setListPlaceQuestion,
  setLogbookPlaceQuestion,
  updateHeatMap,
} from '@reportlog/contracts';
import type {
  HeatMapAdmin,
  ListCandidate,
  LogbookCandidate,
  MapPlane,
  MapView,
  ResponseOf,
  Stance,
} from '@reportlog/contracts';
import { placeLabel } from '@reportlog/fields';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { CheckOption } from '../../components/ui/choice.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { KeyValueList } from '../../components/ui/key-value-list.tsx';
import { Field, FieldDescription, FieldError } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { call } from '../../lib/api.ts';
import { adminMapsQuery, mapCandidatesQuery } from './queries.ts';

const PLANES: [MapPlane, string][] = [
  ['us', 'The United States, by state'],
  ['world', 'The world, by country'],
];
const VIEWS: [MapView, string][] = [
  ['volume', 'How many'],
  ['outcome', 'Outcome: how the answers to one question lean'],
];
const STANCES: [Stance | '', string][] = [
  ['', 'Not counted'],
  ['positive', 'Positive'],
  ['neutral', 'Neither'],
  ['negative', 'Negative'],
];

export function MapAdmin({ ask = (q: string) => window.confirm(q) }: { ask?: Ask } = {}) {
  const maps = useQuery(adminMapsQuery());
  const cands = useQuery(mapCandidatesQuery());
  const [making, setMaking] = useState(false);
  const none = maps.data?.maps.length === 0;
  const make = (
    <Button
      aria-expanded={making}
      onClick={() => {
        setMaking(!making);
      }}
    >
      Make a map
    </Button>
  );
  return (
    <UnsavedMaps ask={ask}>
      <StaffPage
        title="Maps"
        lede="Where published reports came from, as counts. Make as many maps as you want. Each is off until you turn it on, and an area with fewer reports than its threshold is never published with its number."
        // One "Make" button at a time: an empty page carries it in its empty state.
        actions={making || none ? null : make}
      >
        {maps.isError ? <Alert tone="serious">{maps.error.message}</Alert> : null}
        {cands.isError ? <Alert tone="serious">{cands.error.message}</Alert> : null}
        {cands.isSuccess ? (
          <PlaceQuestions logbooks={cands.data.logbooks} lists={cands.data.lists} />
        ) : null}
        {maps.isPending || cands.isPending ? <p role="status">Reading the maps…</p> : null}
        {maps.isSuccess && cands.isSuccess ? (
          <>
            {making ? (
              <NewMap
                onDone={() => {
                  setMaking(false);
                }}
              />
            ) : null}
            {none && !making ? (
              <Empty title="No maps yet">
                Make one, choose what feeds it, then turn it on.
                <span className="mt-3 flex justify-center">{make}</span>
              </Empty>
            ) : null}
            {maps.data.slots.map((slot) => {
              const here = maps.data.maps.filter((m) => m.slot === slot.id);
              if (!here.length) return null;
              return (
                <section key={slot.id} aria-label={slot.label} className="flex flex-col gap-3">
                  <h2 className="font-display text-2xl font-bold">{slot.label}</h2>
                  <p className="text-sm text-muted">{slot.description}</p>
                  <ul className="flex flex-col gap-3">
                    {here.map((m, i) => (
                      <li key={m.id}>
                        <MapCard
                          map={m}
                          order={here.map((x) => x.id)}
                          index={i}
                          slots={maps.data.slots}
                          logbooks={cands.data.logbooks}
                          lists={cands.data.lists}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        ) : null}
      </StaffPage>
    </UnsavedMaps>
  );
}

// ── unsaved changes ──────────────────────────────────────────────────────
//
// ONE QUESTION FOR THE WHOLE SCREEN, as the settings screens ask it: several
// maps can be open at once, and one blocker per map would ask once per map.
// Each editor says whether it differs from the map the server holds; the
// screen asks once, naming every one that does, before the router leaves it
// and before the tab is closed or reloaded (the browser asks that one in its
// own words). Closing one editor asks about that map alone.
//
// "Differs from what the server holds", not "was typed in": ticking a box
// and unticking it again leaves nothing to lose, and a save makes the editor
// clean the moment the server's answer arrives.

type Ask = (question: string) => boolean;

/** The sentence the warning asks, naming what would be lost. */
export function unsavedMapsQuestion(titles: readonly string[]): string {
  const named = titles.map((t) => `“${t}”`);
  const list =
    named.length <= 1
      ? `the map ${named[0] ?? ''}`.trim()
      : `the maps ${named.slice(0, -1).join(', ')} and ${named.at(-1) ?? ''}`;
  return `You have changes to ${list} that are not saved. Leave without saving them?`;
}

const UnsavedContext = createContext<{
  set: (id: number, title: string | null) => void;
  has: (id: number) => boolean;
  ask: Ask;
} | null>(null);

function UnsavedMaps({ ask, children }: { ask: Ask; children: ReactNode }) {
  const unsaved = useRef(new Map<number, string>());
  const set = useCallback((id: number, title: string | null) => {
    if (title === null) unsaved.current.delete(id);
    else unsaved.current.set(id, title);
  }, []);
  useBlocker({
    shouldBlockFn: () => {
      const titles = [...unsaved.current.values()];
      if (!titles.length) return false;
      return !ask(unsavedMapsQuestion(titles));
    },
    enableBeforeUnload: () => unsaved.current.size > 0,
  });
  const has = useCallback((id: number) => unsaved.current.has(id), []);
  const value = useMemo(() => ({ set, has, ask }), [set, has, ask]);
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

/** Tell the screen whether this map's editor holds something the server does not. */
function useUnsavedMap(id: number, title: string, dirty: boolean): void {
  const guard = useContext(UnsavedContext);
  useEffect(() => {
    guard?.set(id, dirty ? title : null);
  }, [guard, id, title, dirty]);
  useEffect(
    () => () => {
      guard?.set(id, null);
    },
    [guard, id],
  );
}

// ── which question places a report ──────────────────────────────────────

function PlaceQuestions({
  logbooks,
  lists,
}: {
  logbooks: LogbookCandidate[];
  lists: ListCandidate[];
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (v: { kind: 'logbook' | 'list'; id: number; key: string | null }) =>
      call(v.kind === 'logbook' ? setLogbookPlaceQuestion : setListPlaceQuestion, {
        params: { id: v.id },
        body: { key: v.key },
      }),
    onSuccess: (data) => {
      setError(null);
      qc.setQueryData(mapCandidatesQuery().queryKey, data);
    },
    onError: (e) => {
      setError(e.message);
    },
  });
  return (
    <Card heading="Which question places a report">
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-sm text-ink-alt">
          A map counts the answers to a “Location on a map” question. If a logbook asks where twice,
          pick the one that says where it happened. This can be set after a logbook has launched: it
          changes nothing that was sealed.
        </p>
        {error ? <Alert tone="serious">{error}</Alert> : null}
        <ul className="flex flex-col gap-3">
          {logbooks.map((l) => (
            <li key={`logbook-${String(l.id)}`}>
              <PlacePicker
                title={l.title}
                note={l.launched ? null : 'A draft: it has no reports yet.'}
                current={l.place_key}
                options={l.places.map((p) => ({ key: p.key, label: p.label, ok: true }))}
                none="This logbook asks no location question, so its reports cannot be placed on a map."
                onPick={(key) => {
                  set.mutate({ kind: 'logbook', id: l.id, key });
                }}
              />
            </li>
          ))}
          {lists.map((l) => (
            <li key={`list-${String(l.id)}`}>
              <PlacePicker
                title={`${l.title} (a list)`}
                note="Only approved entries are counted, and only on a map that names this list."
                current={l.place_key}
                options={l.places.map((p) => ({ key: p.key, label: p.label, ok: p.durable }))}
                none="This list asks no location question. Add one on the list's page to put it on a map."
                onPick={(key) => {
                  set.mutate({ kind: 'list', id: l.id, key });
                }}
              />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function PlacePicker({
  title,
  note,
  current,
  options,
  none,
  onPick,
}: {
  title: string;
  note: string | null;
  current: string | null;
  options: { key: string; label: string; ok: boolean }[];
  none: string;
  onPick: (key: string | null) => void;
}) {
  return (
    <Field className="flex flex-col gap-1">
      <Label>{title}</Label>
      {note ? <FieldDescription>{note}</FieldDescription> : null}
      {options.length ? (
        <Select
          value={current ?? ''}
          onChange={(e) => {
            onPick(e.target.value || null);
          }}
        >
          <option value="">Not on any map</option>
          {options.map((o) => (
            <option key={o.key} value={o.key} disabled={!o.ok}>
              {o.label}
              {o.ok ? '' : ' (its answers are erased, so it cannot be counted)'}
            </option>
          ))}
        </Select>
      ) : (
        <p className="text-sm text-muted">{none}</p>
      )}
    </Field>
  );
}

// ── making one ──────────────────────────────────────────────────────────

function NewMap({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const make = useMutation({
    mutationFn: () => call(createHeatMap, { body: { title, slug } }),
    onSuccess: async () => {
      setTitle('');
      setSlug('');
      await qc.invalidateQueries({ queryKey: adminMapsQuery().queryKey });
      onDone();
    },
  });
  return (
    <Card heading="Make a map">
      <div>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            make.mutate();
          }}
        >
          <Field className="flex-1">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </Field>
          <Field className="flex-1">
            <Label>Short name</Label>
            <FieldDescription>
              Lowercase letters, numbers and hyphens. It goes in the map’s address.
            </FieldDescription>
            <Input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Button type="submit" disabled={make.isPending}>
            Make the map
          </Button>
          <Button type="button" variant="quiet" onClick={onDone}>
            Cancel
          </Button>
        </form>
        {make.isError ? (
          <Alert tone="serious" className="mt-3">
            {make.error.message}
          </Alert>
        ) : null}
        <p className="mt-3 text-sm text-muted">
          A new map is off. Nothing is published until you turn it on.
        </p>
      </div>
    </Card>
  );
}

// ── one map ─────────────────────────────────────────────────────────────

function MapCard({
  map,
  order,
  index,
  slots,
  logbooks,
  lists,
}: {
  map: HeatMapAdmin;
  order: number[];
  index: number;
  slots: { id: string; label: string; description: string }[];
  logbooks: LogbookCandidate[];
  lists: ListCandidate[];
}) {
  const qc = useQueryClient();
  const guard = useContext(UnsavedContext);
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: adminMapsQuery().queryKey });
  const arrange = useMutation({
    mutationFn: (ids: number[]) => call(arrangeHeatMaps, { body: { slot: map.slot, ids } }),
    onSuccess: refresh,
  });
  const move = (by: -1 | 1) => {
    const ids = [...order];
    const j = index + by;
    const here = ids[index];
    const there = ids[j];
    if (here === undefined || there === undefined) return;
    ids[index] = there;
    ids[j] = here;
    arrange.mutate(ids);
  };
  const named = (ids: readonly number[], from: readonly { id: number; title: string }[]) =>
    ids.map((id) => from.find((x) => x.id === id)?.title ?? `#${String(id)}`).join(', ');
  return (
    <Card heading={map.title}>
      <div className="flex flex-col gap-3">
        <KeyValueList
          items={[
            { key: 'Shown', value: map.enabled ? 'On: readers can see it' : 'Off' },
            { key: 'Short name', value: map.slug, mono: true },
            { key: 'Threshold', value: thresholdInWords(map.min_area) },
            {
              key: 'Fed by',
              value: [
                map.logbook_ids.length ? named(map.logbook_ids, logbooks) : 'every logbook',
                map.list_ids.length ? named(map.list_ids, lists) : null,
              ]
                .filter(Boolean)
                .join('; '),
            },
            {
              key: 'Planes',
              value: map.planes.map((pl) => PLANES.find(([id]) => id === pl)?.[1] ?? pl).join('; '),
            },
            {
              key: 'Where it appears',
              value: slots.find((sl) => sl.id === map.slot)?.label ?? map.slot,
            },
            { key: 'Public address', value: `/map/${map.slug}`, mono: true },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"

            variant="secondary"
            aria-expanded={open}
            onClick={() => {
              if (open && guard?.has(map.id) && !guard.ask(unsavedMapsQuestion([map.title]))) {
                return;
              }
              setOpen((o) => !o);
            }}
          >
            {open ? 'Close' : 'Change'}
          </Button>
          <Button
            type="button"

            variant="secondary"
            disabled={index === 0 || arrange.isPending}
            onClick={() => {
              move(-1);
            }}
          >
            Move up
          </Button>
          <Button
            type="button"

            variant="secondary"
            disabled={index === order.length - 1 || arrange.isPending}
            onClick={() => {
              move(1);
            }}
          >
            Move down
          </Button>
          {map.enabled ? (
            <Button asChild variant="quiet">
              <Link to="/map/$slug" params={{ slug: map.slug }}>
                Open it
              </Link>
            </Button>
          ) : null}
        </div>
        {open ? (
          <MapEditor map={map} slots={slots} logbooks={logbooks} lists={lists} onSaved={refresh} />
        ) : null}
      </div>
    </Card>
  );
}

function Tick({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <CheckOption
      id={id}
      checked={checked}
      onCheckedChange={(on) => {
        onChange(on === true);
      }}
      label={children}
    />
  );
}

/** A map as the editor's fields hold it. */
function fieldsOf(map: HeatMapAdmin) {
  return {
    title: map.title,
    slug: map.slug,
    blurb: map.blurb ?? '',
    enabled: map.enabled,
    minArea: String(map.min_area),
    planes: map.planes,
    views: map.views,
    logbookIds: map.logbook_ids,
    listIds: map.list_ids,
    outcome: map.outcome,
    slot: map.slot,
  };
}

/**
 * The fields as one string, with every set sorted: ticking a box off and on
 * again moves it to the end of its list, which changes nothing that is saved.
 */
function comparable(f: ReturnType<typeof fieldsOf>): string {
  const sorted = <T extends string | number>(xs: readonly T[]) =>
    [...xs].sort((a, b) => String(a).localeCompare(String(b)));
  return JSON.stringify({
    ...f,
    planes: sorted(f.planes),
    views: sorted(f.views),
    logbookIds: sorted(f.logbookIds),
    listIds: sorted(f.listIds),
    outcome: f.outcome && {
      ...f.outcome,
      stances: Object.entries(f.outcome.stances).sort(([a], [b]) => a.localeCompare(b)),
    },
  });
}

/** The threshold as a reader of the list needs it, not a bare number. */
export const thresholdInWords = (n: number) =>
  `an area shows its number at ${String(n)} reports or more`;

const toggle = <T,>(list: readonly T[], item: T, on: boolean): T[] =>
  on ? [...new Set([...list, item])] : list.filter((x) => x !== item);

function MapEditor({
  map,
  slots,
  logbooks,
  lists,
  onSaved,
}: {
  map: HeatMapAdmin;
  slots: { id: string; label: string; description: string }[];
  logbooks: LogbookCandidate[];
  lists: ListCandidate[];
  onSaved: () => Promise<void>;
}) {
  // What the server holds, as this editor last heard it: the map it opened
  // with, then each save's answer. Unsaved means the fields differ from it.
  const [base, setBase] = useState(map);
  const [title, setTitle] = useState(map.title);
  const [slug, setSlug] = useState(map.slug);
  const [blurb, setBlurb] = useState(map.blurb ?? '');
  const [enabled, setEnabled] = useState(map.enabled);
  const [minArea, setMinArea] = useState(String(map.min_area));
  const [planes, setPlanes] = useState<MapPlane[]>(map.planes);
  const [views, setViews] = useState<MapView[]>(map.views);
  const [logbookIds, setLogbookIds] = useState<number[]>(map.logbook_ids);
  const [listIds, setListIds] = useState<number[]>(map.list_ids);
  const [outcome, setOutcome] = useState(map.outcome);
  const [slot, setSlot] = useState(map.slot);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const outcomeChoices = logbooks.flatMap((l) =>
    l.outcomes.map((q) => ({
      value: `${String(l.id)}:${q.key}`,
      logbookId: l.id,
      q,
      book: l.title,
    })),
  );
  const outcomeQuestion = outcome
    ? outcomeChoices.find((c) => c.logbookId === outcome.logbook_id && c.q.key === outcome.key)
    : undefined;

  const draft = {
    title,
    slug,
    blurb,
    enabled,
    minArea,
    planes,
    views,
    logbookIds,
    listIds,
    outcome,
    slot,
  };
  useUnsavedMap(map.id, map.title, comparable(draft) !== comparable(fieldsOf(base)));

  const save = useMutation({
    mutationFn: () =>
      call(updateHeatMap, {
        params: { id: map.id },
        body: {
          title,
          slug,
          blurb,
          enabled,
          min_area: Number(minArea),
          planes,
          views,
          logbook_ids: logbookIds,
          list_ids: listIds,
          outcome,
          slot,
        },
      }),
    onSuccess: async (saved) => {
      // The server's answer, not what was sent: it may have tidied a value,
      // and the editor must not call its own tidied value unsaved.
      const f = fieldsOf(saved);
      setBase(saved);
      setTitle(f.title);
      setSlug(f.slug);
      setBlurb(f.blurb);
      setEnabled(f.enabled);
      setMinArea(f.minArea);
      setPlanes(f.planes);
      setViews(f.views);
      setLogbookIds(f.logbookIds);
      setListIds(f.listIds);
      setOutcome(f.outcome);
      setSlot(f.slot);
      await onSaved();
    },
  });
  const preview = useMutation({
    mutationFn: () => call(previewHeatMap, { params: { id: map.id } }),
  });
  const remove = useMutation({
    mutationFn: () => call(deleteHeatMap, { params: { id: map.id } }),
    onSuccess: onSaved,
  });

  return (
    <form
      aria-label={`Change ${map.title}`}
      // The server refuses a wrong threshold in a sentence that says why; the
      // browser's own check would stop the form with a generic one.
      noValidate
      className="flex flex-col gap-5 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Tick checked={enabled} onChange={setEnabled}>
        On: readers can see this map
      </Tick>
      <Field>
        <Label>Title</Label>
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </Field>
      <Field>
        <Label>Short name</Label>
        <Input
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field>
        <Label>What it shows, for a reader</Label>
        <Textarea
          rows={3}
          value={blurb}
          onChange={(e) => {
            setBlurb(e.target.value);
          }}
        />
      </Field>
      <Field>
        <Label>Threshold</Label>
        <FieldDescription>
          An area is shaded only with at least this many reports. Under it, the area is sent with no
          number at all. The least is {MIN_AREA_FLOOR}; the usual is {DEFAULT_MIN_AREA}. A single
          report in a thinly covered place can identify the person who filed it, and an area
          crossing the threshold tells a daily watcher that a report arrived there: think hardest
          about this in a small place. The threshold hides counts, not places: every published
          report still shows its own place, and with one thin area the logbook’s total minus the
          areas shown gives that area’s count.
        </FieldDescription>
        <Input
          type="number"
          inputMode="numeric"
          min={MIN_AREA_FLOOR}
          value={minArea}
          onChange={(e) => {
            setMinArea(e.target.value);
          }}
          className="max-w-32"
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">Which maps it offers</legend>
        {PLANES.map(([p, name]) => (
          <Tick
            key={p}
            checked={planes.includes(p)}
            onChange={(on) => {
              setPlanes((x) => toggle(x, p, on));
            }}
          >
            {name}
          </Tick>
        ))}
        <p className="text-sm text-muted">
          A state answer is on the United States map; a country answer is on the world map. States
          are not added up into the United States, because the difference would give away the areas
          under the threshold.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">What the colour can show</legend>
        {VIEWS.map(([v, name]) => (
          <Tick
            key={v}
            checked={views.includes(v)}
            onChange={(on) => {
              setViews((x) => toggle(x, v, on));
            }}
          >
            {name}
          </Tick>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">Which logbooks feed it</legend>
        <p className="text-sm text-muted">Tick none for every logbook.</p>
        {logbooks.map((l) => (
          <Tick
            key={l.id}
            checked={logbookIds.includes(l.id)}
            onChange={(on) => {
              setLogbookIds((x) => toggle(x, l.id, on));
            }}
          >
            {l.title}
            {l.place_key ? '' : ' (no question places its reports yet)'}
          </Tick>
        ))}
      </fieldset>

      {lists.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Which lists feed it</legend>
          <p className="text-sm text-muted">
            Tick none for no lists. Only approved entries are counted, and the map says “entries”,
            not “reports”.
          </p>
          {lists.map((l) => (
            <Tick
              key={l.id}
              checked={listIds.includes(l.id)}
              onChange={(on) => {
                setListIds((x) => toggle(x, l.id, on));
              }}
            >
              {l.title}
              {l.place_key ? '' : ' (no question places its entries yet)'}
            </Tick>
          ))}
        </fieldset>
      ) : null}

      {views.includes('outcome') || outcome ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">The outcome question</legend>
          <Field>
            <Label>Question</Label>
            <Select
              value={outcome ? `${String(outcome.logbook_id)}:${outcome.key}` : ''}
              onChange={(e) => {
                const c = outcomeChoices.find((x) => x.value === e.target.value);
                setOutcome(c ? { logbook_id: c.logbookId, key: c.q.key, stances: {} } : null);
              }}
            >
              <option value="">None</option>
              {outcomeChoices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.book}: {c.q.label}
                </option>
              ))}
            </Select>
          </Field>
          {outcome && outcomeQuestion
            ? outcomeQuestion.q.options.map((answer) => (
                <Field key={answer}>
                  <Label>“{answer}” counts as</Label>
                  <Select
                    value={outcome.stances[answer] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      const rest = Object.entries(outcome.stances).filter(([a]) => a !== answer);
                      const next: Record<string, Stance> = Object.fromEntries(
                        v === 'positive' || v === 'neutral' || v === 'negative'
                          ? [...rest, [answer, v]]
                          : rest,
                      );
                      setOutcome({ ...outcome, stances: next });
                    }}
                  >
                    {STANCES.map(([v, name]) => (
                      <option key={v} value={v}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))
            : null}
        </fieldset>
      ) : null}

      <Field>
        <Label>Where it appears</Label>
        <Select
          value={slot}
          onChange={(e) => {
            setSlot(e.target.value);
          }}
        >
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        <FieldDescription>{slots.find((s) => s.id === slot)?.description}</FieldDescription>
      </Field>

      {save.isError ? (
        <FieldError>{save.error.message}</FieldError>
      ) : save.isSuccess ? (
        <p role="status" className="text-sm">
          Saved.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          Save the map
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            preview.mutate();
          }}
        >
          What would it publish?
        </Button>
        {confirmDelete ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              remove.mutate();
            }}
          >
            Yes, delete this map
          </Button>
        ) : (
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            Delete the map
          </Button>
        )}
      </div>
      {confirmDelete ? (
        <p className="text-sm text-muted">
          Deleting a map takes no report with it. Its address stops working.
        </p>
      ) : null}
      {remove.isError ? <Alert tone="serious">{remove.error.message}</Alert> : null}
      {preview.isError ? <Alert tone="serious">{preview.error.message}</Alert> : null}
      {preview.data ? <Preview result={preview.data} /> : null}
    </form>
  );
}

function Preview({ result }: { result: ResponseOf<typeof previewHeatMap> }) {
  const map = result.map;
  if (!map.published) return <Alert>{map.reason}</Alert>;
  const shaded = Object.entries(map.areas).sort(([, a], [, b]) => b.n - a.n);
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-control border border-line p-3 text-sm"
    >
      <p className="font-semibold">
        Saved settings, counted now, under a threshold of {map.threshold}:
      </p>
      <p>
        Shaded:{' '}
        {shaded.length
          ? shaded.map(([code, a]) => `${placeLabel(code)} ${String(a.n)}`).join(', ')
          : 'none'}
        .
      </p>
      <p>
        Under the threshold, sent without a number:{' '}
        {map.suppressed.areas.length
          ? map.suppressed.areas.map((c) => placeLabel(c)).join(', ')
          : 'none'}
        .
      </p>
      {result.unplaced.no_question ? (
        <p>
          {result.unplaced.no_question} published report(s) could not be placed: their logbook has
          no question placing them, or they did not answer it.
        </p>
      ) : null}
      {result.unplaced.country_only ? (
        <p>{result.unplaced.country_only} gave only a country, and this map draws no countries.</p>
      ) : null}
    </div>
  );
}
