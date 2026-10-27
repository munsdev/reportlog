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
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
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
      <p className="text-ink-alt">
        Testers see each other’s issues under a masked handle (the first letters of an address),
        never the address itself.
      </p>
      <Card heading="Make somebody a tester">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate({ email, tester: true });
          }}
        >
          <Field>
            <Label>Their email address</Label>
            <FieldDescription>
              Testers recognise each other by a shortened form of their address, so add only people
              the others would be comfortable being identifiable to.
            </FieldDescription>
            <Input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </Field>
          {change.isError ? (
            <Alert tone="serious" title="That did not change.">
              {change.error.message}
            </Alert>
          ) : null}
          <div>
            <Button type="submit" variant="secondary" disabled={change.isPending}>
              Give the flag
            </Button>
          </div>
        </form>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="testers-now">
        <h2 id="testers-now" className="font-display text-xl font-bold">
          Testers now
        </h2>
        {list.isPending ? <p role="status">Loading…</p> : null}
        {list.isError ? <p role="alert">{list.error.message}</p> : null}
        {list.data?.testers.length === 0 ? (
          <Empty title="Nobody has the flag">Give it above to let somebody file feedback.</Empty>
        ) : null}
        <ul className="flex flex-col divide-y divide-line">
          {list.data?.testers.map((t) => (
            <li key={t.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-mono text-sm break-all">{t.email}</span>
                {t.roles.length ? (
                  <span className="text-sm text-ink-alt">
                    {' '}
                    (
                    {t.roles.map((r) => (ROLE_LABELS as Record<string, string>)[r] ?? r).join(', ')}
                    )
                  </span>
                ) : null}
              </span>
              <Button
                variant="quiet"

                disabled={change.isPending}
                onClick={() => {
                  change.mutate({ email: t.email, tester: false });
                }}
              >
                Take the flag away<span className="sr-only"> from {t.email}</span>
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </StaffPage>
  );
}
