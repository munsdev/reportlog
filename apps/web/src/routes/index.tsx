/**
 * The front page: the operator's headline and lede, the buttons in the
 * operator's order (the first one is the accent and no other is), what
 * this archive is for, and checking a report by its reference.
 */
import { getHomeButtons } from '@reportlog/contracts';
import type { HomeButton } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Field } from '../components/ui/field.tsx';
import { Input } from '../components/ui/input.tsx';
import { Label } from '../components/ui/label.tsx';
import { Page } from '../components/ui/page.tsx';
import { useSite } from '../components/ui/site.tsx';
import { MapSlot } from '../features/maps/MapSlot.tsx';
import { call } from '../lib/api.ts';

export const homeButtonsQuery = queryOptions({
  queryKey: ['home-buttons'],
  queryFn: ({ signal }) => call(getHomeButtons, { signal }),
});

export const Route = createFileRoute('/')({
  component: Home,
});

/**
 * A button that goes somewhere is a link styled as one. One that acts in
 * place (the alert sign-up) has nothing to act with until that sign-up is
 * built, so it is not drawn rather than drawn dead.
 */
export function HomeButtons({ buttons }: { buttons: readonly HomeButton[] }) {
  const drawn = buttons.filter((b) => b.href);
  if (!drawn.length) return null;
  return (
    <ul className="flex flex-col gap-3 sm:flex-row sm:flex-wrap" aria-label="What you can do here">
      {drawn.map((b) => (
        <li key={`${b.kind}:${b.ref}`}>
          <Button asChild variant={b.accent ? 'primary' : 'secondary'}>
            <a href={b.href ?? undefined}>{b.label}</a>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the front page offers when the buttons cannot be fetched. The page
 * must never be a dead end because one call failed: these two are the
 * software's own destinations, so they exist on every deployment, and their
 * wording is the same as the built-ins' (api/src/logbooks/homeButtons.ts).
 */
export const FALLBACK_BUTTONS: readonly HomeButton[] = [
  {
    kind: 'builtin',
    ref: 'submit',
    label: 'Submit a Report',
    title: 'Submit a Report',
    href: '/submit',
    action: null,
    blurb: null,
    help: null,
    accent: true,
  },
  {
    kind: 'builtin',
    ref: 'board',
    label: 'View Live Report Board',
    title: 'View Live Report Board',
    href: '/board',
    action: null,
    blurb: null,
    help: null,
    accent: false,
  },
];

function CheckAReport() {
  const navigate = useNavigate();
  const [ref, setRef] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Check a report</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="max-w-prose text-ink-alt">
          Every report has a reference, given when it was filed. Enter one to check that it has not
          been changed since.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = ref.trim();
            if (trimmed) void navigate({ to: '/verify/$ref', params: { ref: trimmed } });
          }}
          className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Field className="flex-1">
            <Label>Report reference</Label>
            <Input
              value={ref}
              onChange={(e) => {
                setRef(e.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <Button type="submit" variant="secondary">
            Check it
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Home() {
  const site = useSite().data;
  const query = useQuery(homeButtonsQuery);
  const buttons = query.isError ? FALLBACK_BUTTONS : (query.data?.buttons ?? []);
  return (
    <Page title={site?.copy.home_headline ?? 'ReportLog'} lede={site?.copy.home_lede}>
      <HomeButtons buttons={buttons} />
      {site ? <p className="max-w-prose whitespace-pre-wrap">{site.copy.home_intro}</p> : null}
      <MapSlot slot="home" />
      <CheckAReport />
    </Page>
  );
}
