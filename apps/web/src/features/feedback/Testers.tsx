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
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
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
    <Page
      title="Testers"
      width="prose"
      lede="Testers can file feedback and read what other testers filed. That is all the flag does: it shows no report and grants no role."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate({ email, tester: true });
        }}
      >
        <Field>
          <Label>Make somebody a tester</Label>
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
          <Button type="submit" disabled={change.isPending}>
            Add the tester
          </Button>
        </div>
      </form>

      <section className="flex flex-col gap-3" aria-labelledby="testers-now">
        <h2 id="testers-now" className="font-display text-xl font-bold">
          Testers now
        </h2>
        {list.isPending ? <p role="status">Loading…</p> : null}
        {list.isError ? <p role="alert">{list.error.message}</p> : null}
        {list.data?.testers.length === 0 ? <p>Nobody has the flag.</p> : null}
        <ul className="flex flex-col gap-2">
          {list.data?.testers.map((t) => (
            <li key={t.email} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t.email}
                {t.role !== 'user' ? (
                  <span className="text-sm text-ink-alt">
                    {' '}
                    ({(ROLE_LABELS as Record<string, string>)[t.role] ?? t.role})
                  </span>
                ) : null}
              </span>
              <Button
                variant="secondary"
               
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
    </Page>
  );
}
