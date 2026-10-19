/**
 * The operator's imprint, privacy policy and moderation standard.
 *
 * An unpublished notice SAYS it is unpublished. It is never filled with a
 * placeholder, because a placeholder that reads like a legal notice is
 * worse than none. Each is shown exactly as the operator wrote it, line
 * breaks and all, as plain text.
 */
import { getLegal } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Alert } from '../components/ui/alert.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Page } from '../components/ui/page.tsx';
import { useSite } from '../components/ui/site.tsx';
import { call } from '../lib/api.ts';

export const legalQuery = queryOptions({
  queryKey: ['legal'],
  queryFn: ({ signal }) => call(getLegal, { signal }),
});

export const Route = createFileRoute('/legal')({
  component: LegalPage,
});

function Notice({
  title,
  text,
  missing,
}: {
  title: string;
  text: string | null | undefined;
  missing: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {text ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <p className="text-ink-alt">{missing}</p>
        )}
      </CardContent>
    </Card>
  );
}

function LegalPage() {
  const legal = useQuery(legalQuery);
  const site = useSite();
  return (
    <Page title="Imprint, privacy and moderation" width="prose">
      {legal.isError ? (
        <Alert tone="serious" title="The legal notices could not be loaded.">
          {legal.error.message}
        </Alert>
      ) : null}
      {legal.isPending ? <p role="status">Loading…</p> : null}
      {legal.isSuccess ? (
        <>
          <Notice
            title="Imprint"
            text={legal.data.impressum}
            missing="The operator of this site has not published an imprint yet."
          />
          <Notice
            title="Privacy policy"
            text={legal.data.privacy}
            missing="The operator of this site has not published a privacy policy yet."
          />
        </>
      ) : null}
      {site.data ? (
        <Notice title="Moderation standard" text={site.data.copy.standards} missing="" />
      ) : null}
    </Page>
  );
}
