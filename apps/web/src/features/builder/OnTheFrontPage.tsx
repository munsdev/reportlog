/**
 * "What is on the front page": each logbook's and each list's front-page
 * switch, on the page that arranges the front page. They were inside each
 * editor ("On the front page"), where they overrode this page's buttons out
 * of sight of it; the decision is now taken in one place.
 *
 * Each switch is the same call the editors made (`show_on_front`), and
 * applies at once: it advertises, and opens or closes nothing. The summaries
 * do not carry the flag, so each logbook's and list's own record is read.
 */
import { updateList, updateLogbook } from '@reportlog/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/mockup/Panel.tsx';
import { Switch } from '@/mockup/Switch.tsx';
import { call } from '../../lib/api.ts';
import { listQuery, listsQuery } from '../lists/queries.ts';
import { homeButtonsAdminQuery, logbookQuery, logbooksQuery } from './queries.ts';
import { Problem } from './controls.tsx';

interface Row {
  kind: 'logbook' | 'list';
  id: number;
  title: string;
  /** Said under its name: what it is, and a draft's "once launched". */
  what: string;
  on: boolean | undefined;
}

export function OnTheFrontPage() {
  const qc = useQueryClient();
  const logbooks = useQuery(logbooksQuery());
  const lists = useQuery(listsQuery());
  // A draft is listed too: switched on, it is shown once it is launched and open.
  const launched = logbooks.data?.logbooks ?? [];
  const listRows = lists.data?.lists ?? [];
  const lbDetails = useQueries({ queries: launched.map((l) => logbookQuery(l.id)) });
  const listDetails = useQueries({ queries: listRows.map((l) => listQuery(l.id)) });

  const rows: Row[] = [
    ...launched.map((l, i) => ({
      kind: 'logbook' as const,
      id: l.id,
      title: l.title,
      what:
        l.state === 'draft' ? 'Logbook, a draft: shown once it is launched and open' : 'Logbook',
      on: lbDetails[i]?.data?.show_on_front,
    })),
    ...listRows.map((l, i) => ({
      kind: 'list' as const,
      id: l.id,
      title: l.title,
      what: 'List',
      on: listDetails[i]?.data?.show_on_front,
    })),
  ];

  const save = useMutation({
    mutationFn: async (r: { kind: Row['kind']; id: number; on: boolean }) => {
      const body = { show_on_front: r.on };
      if (r.kind === 'logbook') await call(updateLogbook, { params: { id: r.id }, body });
      else await call(updateList, { params: { id: r.id }, body });
    },
    onSuccess: async (_d, r) => {
      await Promise.all([
        qc.invalidateQueries({
          queryKey: ['admin', r.kind === 'logbook' ? 'logbooks' : 'lists', r.id],
        }),
        qc.invalidateQueries({ queryKey: homeButtonsAdminQuery().queryKey }),
      ]);
    },
  });

  return (
    <Panel title="What is on the front page">
      <p className="m">
        A logbook or list that is switched on here is a button on the front page while it is open,
        added at the end if the buttons below do not place it. Switched off, it is not shown there,
        whatever the buttons say.
      </p>
      {logbooks.isPending || lists.isPending ? <p role="status">Reading what there is…</p> : null}
      <Problem error={logbooks.error ?? lists.error ?? save.error} />
      {logbooks.data && lists.data && rows.length === 0 ? (
        <p className="m">There is no logbook or list yet.</p>
      ) : null}
      {rows.map((r) => (
        <Switch
          key={`${r.kind}:${String(r.id)}`}
          label={r.title}
          help={r.what}
          checked={r.on === true}
          disabled={r.on === undefined || save.isPending}
          onChange={(on) => {
            save.mutate({ kind: r.kind, id: r.id, on });
          }}
        />
      ))}
    </Panel>
  );
}
