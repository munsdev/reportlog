/**
 * Who has the tester flag, and giving or taking it. Administrators and
 * Access Managers, the same people who grant access.
 *
 * The flag opens the feedback tracker and nothing else: a tester sees issues,
 * never a report. Testers see each other's handles, which a small group
 * decodes at once, so add only people the others would be comfortable being
 * identifiable to.
 */
import { setTester } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { Btn } from '@/mockup/Btn.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { TextField } from '@/mockup/Field.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { ROLE_LABELS } from '../identity/session.ts';
import { testersQuery } from './queries.ts';

export function Testers() {
  const client = useQueryClient();
  const list = useQuery(testersQuery);
  const [email, setEmail] = useState('');
  const change = useMutation({
    mutationFn: (v: { email: string; tester: boolean }) => call(setTester, { body: v }),
    onSuccess: () => {
      setEmail('');
      void client.invalidateQueries({ queryKey: testersQuery.queryKey });
    },
  });

  return (
    <StaffPage title="Testers" width="prose" lede="Testers can file feedback from any page.">
      <p className="m">
        Testers see each other’s issues under a masked handle (the first letters of an address),
        never the address itself.
      </p>
      <Panel title="Make somebody a tester">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate({ email, tester: true });
          }}
        >
          <TextField
            label="Their email address"
            help="Testers recognise each other by a shortened form of their address, so add only people the others would be comfortable being identifiable to."
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
          <ErrorLine error={change.error} />
          <Btn sm flat look="ink" type="submit" disabled={change.isPending}>
            Give the flag
          </Btn>
        </form>
      </Panel>

      <Panel title="Testers now">
        {list.isPending ? <p role="status">Loading…</p> : null}
        <ErrorLine error={list.error} />
        {list.data?.testers.length === 0 ? (
          <Empty title="Nobody has the flag">Give it above to let somebody file feedback.</Empty>
        ) : null}
        {list.data && list.data.testers.length > 0 ? (
          <Tbl
            cols={['Who', '']}
            widths="1fr auto"
            rows={list.data.testers.map((t) => ({
              key: t.email,
              cells: [
                <>
                  {t.email}
                  {t.roles.length
                    ? ` (${t.roles.map((r) => (ROLE_LABELS as Record<string, string>)[r] ?? r).join(', ')})`
                    : ''}
                </>,
                <Btn
                  sm
                  flat
                  look="ghost"
                  disabled={change.isPending}
                  onClick={() => {
                    change.mutate({ email: t.email, tester: false });
                  }}
                >
                  Take the flag away<span className="sr-only"> from {t.email}</span>
                </Btn>,
              ],
            }))}
          />
        ) : null}
      </Panel>
    </StaffPage>
  );
}
