/**
 * The development notice: "Under active development" in the corner of
 * every page. A deploy turns it on for a few hours by itself; this is the
 * manual override, on for a window or off now.
 *
 * A SWITCH, NOT A FORM. It applies the moment it is pressed, so there is
 * nothing unsaved to warn about, and no Save.
 */
import { getDevMode, setDevMode } from '@reportlog/contracts';
import type { DevMode } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Page } from '@/components/ui/page.tsx';
import { call } from '@/lib/api.ts';

const devModeQuery = queryOptions({
  queryKey: ['site-editor', 'dev-mode'],
  queryFn: ({ signal }) => call(getDevMode, { signal }),
});

export const Route = createFileRoute('/(staff)/settings/development')({
  component: DevelopmentPage,
});

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function DevModeSwitch({ state }: { state: DevMode }) {
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: (hours: number | null) => call(setDevMode, { body: { hours } }),
    onSuccess: (next) => {
      client.setQueryData(devModeQuery.queryKey, next);
      // Every page reads the notice from the site's settings.
      void client.invalidateQueries({ queryKey: ['site'] });
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <p role="status">
        {state.active && state.until
          ? `The notice is showing until ${when(state.until)}.`
          : 'The notice is not showing.'}
      </p>
      {change.isError ? (
        <Alert tone="serious" title="That did not change.">
          {change.error.message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={change.isPending}
          onClick={() => {
            change.mutate(state.default_hours);
          }}
        >
          {state.active
            ? `Show it for ${String(state.default_hours)} hours from now`
            : `Turn it on for ${String(state.default_hours)} hours`}
        </Button>
        {state.active ? (
          <Button
            type="button"
            variant="quiet"
            disabled={change.isPending}
            onClick={() => {
              change.mutate(null);
            }}
          >
            Turn it off now
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DevelopmentPage() {
  const state = useQuery(devModeQuery);
  return (
    <Page
      title="Development notice"
      width="prose"
      lede="A note in the corner of every page saying the site is being worked on and may change while somebody uses it."
    >
      <p>
        Each new release turns it on for a few hours by itself, so testers know why something just
        moved. It always switches itself off: a notice left on for good teaches people to ignore it.
        Use this to show it while you are making changes by hand, or to take it down once things
        have settled.
      </p>
      {state.isPending ? <p role="status">Loading…</p> : null}
      {state.isError ? (
        <Alert tone="serious" title="The notice’s state could not be read.">
          {state.error.message}
        </Alert>
      ) : null}
      {state.data ? <DevModeSwitch state={state.data} /> : null}
    </Page>
  );
}
