/**
 * "Where things appear": on the page that arranges the front page, where
 * each logbook and list is advertised on the public site, decided in one
 * place.
 *
 *   A logbook: on the front page or not (it was a switch in its editor).
 *   A list: on the front page, on Get involved, and whether it is the
 *   site's contact form, which the footer, the site menu, About and the
 *   terms link to. One list at most is the contact form; choosing another
 *   moves it (the server and the database both keep it to one).
 *
 * Each switch applies at once and advertises only: it opens, closes or hides
 * nothing. The summaries do not carry these flags, so each logbook's and
 * list's own record is read.
 */
import { updateList, updateLogbook } from '@reportlog/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/mockup/Panel.tsx';
import { Switch } from '@/mockup/Switch.tsx';
import { call } from '../../lib/api.ts';
import { listQuery, listsQuery } from '../lists/queries.ts';
import { homeButtonsAdminQuery, logbookQuery, logbooksQuery } from './queries.ts';
import { Problem } from './controls.tsx';

type ListFlag = 'show_on_front' | 'on_get_involved' | 'is_contact';
type Change =
  | { kind: 'logbook'; id: number; on: boolean }
  | { kind: 'list'; id: number; flag: ListFlag; on: boolean };

export function OnTheFrontPage() {
  const qc = useQueryClient();
  const logbooks = useQuery(logbooksQuery());
  const lists = useQuery(listsQuery());
  // A draft is listed too: switched on, it is shown once it is launched and open.
  const lbRows = logbooks.data?.logbooks ?? [];
  const listRows = lists.data?.lists ?? [];
  const lbDetails = useQueries({ queries: lbRows.map((l) => logbookQuery(l.id)) });
  const listDetails = useQueries({ queries: listRows.map((l) => listQuery(l.id)) });

  const save = useMutation({
    mutationFn: async (c: Change) => {
      if (c.kind === 'logbook') {
        await call(updateLogbook, { params: { id: c.id }, body: { show_on_front: c.on } });
      } else {
        await call(updateList, { params: { id: c.id }, body: { [c.flag]: c.on } });
      }
    },
    onSuccess: async (_d, c) => {
      await Promise.all([
        // A new contact form un-marks the old one, so every list is read again.
        qc.invalidateQueries({ queryKey: ['admin', c.kind === 'logbook' ? 'logbooks' : 'lists'] }),
        qc.invalidateQueries({ queryKey: homeButtonsAdminQuery().queryKey }),
        qc.invalidateQueries({ queryKey: ['open-lists'] }),
      ]);
    },
  });
  const busy = save.isPending;

  return (
    <Panel title="Where things appear">
      <p className="m">
        Each switch applies at once. Nothing here opens or closes a logbook or list: something is
        shown only while it is open.
      </p>
      {logbooks.isPending || lists.isPending ? <p role="status">Reading what there is…</p> : null}
      <Problem error={logbooks.error ?? lists.error ?? save.error} />
      {logbooks.data && lists.data && lbRows.length + listRows.length === 0 ? (
        <p className="m">There is no logbook or list yet.</p>
      ) : null}

      {lbRows.length ? <h3 className="lbl">Logbooks</h3> : null}
      {lbRows.map((l, i) => {
        const on = lbDetails[i]?.data?.show_on_front;
        return (
          <Switch
            key={`logbook:${String(l.id)}`}
            label={`${l.title}: on the front page`}
            help={
              l.state === 'draft'
                ? 'A draft: shown once it is launched and open. A button at the end if the buttons below do not place it.'
                : 'A button at the end if the buttons below do not place it. Off, it is not shown there, whatever they say.'
            }
            checked={on === true}
            disabled={on === undefined || busy}
            onChange={(next) => {
              save.mutate({ kind: 'logbook', id: l.id, on: next });
            }}
          />
        );
      })}

      {listRows.length ? <h3 className="lbl">Lists</h3> : null}
      {listRows.map((l, i) => {
        const d = listDetails[i]?.data;
        const flip = (flag: ListFlag) => (next: boolean) => {
          save.mutate({ kind: 'list', id: l.id, flag, on: next });
        };
        return (
          <fieldset key={`list:${String(l.id)}`} style={FIELDSET}>
            <legend className="lbl">{l.title}</legend>
            <Switch
              label="On the front page"
              help="A button at the end if the buttons below do not place it."
              checked={d?.show_on_front === true}
              disabled={!d || busy}
              onChange={flip('show_on_front')}
            />
            <Switch
              label="On Get involved"
              help="A card on the Get involved page, as a way to help."
              checked={d?.on_get_involved === true}
              disabled={!d || busy}
              onChange={flip('on_get_involved')}
            />
            <Switch
              label="The contact form"
              help="The footer, the site menu, About and the terms send people here to write to you. One list at a time."
              checked={d?.is_contact === true}
              disabled={!d || busy}
              onChange={flip('is_contact')}
            />
          </fieldset>
        );
      })}
    </Panel>
  );
}

// As the other forms draw a group of switches (LimitsForm.tsx, CardFrame.tsx).
const FIELDSET = { border: 0, padding: 0, margin: '8px 0 0', display: 'grid', gap: 6 } as const;
