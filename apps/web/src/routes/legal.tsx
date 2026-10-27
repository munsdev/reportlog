/**
 * The operator's imprint and privacy policy. The moderation standard has
 * its own page (/standards), linked from here.
 *
 * An unpublished notice SAYS it is unpublished. It is never filled with a
 * placeholder, because a placeholder that reads like a legal notice is
 * worse than none. Each is shown exactly as the operator wrote it, line
 * breaks and all, as plain text.
 */
import { getLegal } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Alert } from '../components/ui/alert.tsx';
import { AsideCard, Prose } from '../components/ui/band.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { call } from '../lib/api.ts';

export const legalQuery = queryOptions({
  queryKey: ['legal'],
  queryFn: ({ signal }) => call(getLegal, { signal }),
});

export const Route = createFileRoute('/legal')({
  component: LegalPage,
});

function Notice({
  id,
  title,
  text,
  missing,
}: {
  id: string;
  title: string;
  text: string | null | undefined;
  missing: string;
}) {
  // Unwritten, a sentence that says so, never a placeholder that reads
  // like the real thing.
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid gap-3.5">
      <h2 id={`${id}-h`}>{title}</h2>
      {text ? (
        <p className="whitespace-pre-wrap">{text}</p>
      ) : (
        <>
          <p className="font-semibold text-ink">Not written yet.</p>
          <p>{missing}</p>
        </>
      )}
    </section>
  );
}

const ON_THIS_PAGE = [
  { id: 'imprint', label: 'Imprint' },
  { id: 'privacy', label: 'Privacy policy' },
] as const;

function LegalPage() {
  const legal = useQuery(legalQuery);
  return (
    <PublicPage
      variant="band"
      title="Imprint and privacy"
      eyebrow="Legal"
      aside={
        <AsideCard title="On this page" plain>
          <ol className="grid list-none gap-1 p-0">
            {ON_THIS_PAGE.map((i) => (
              <li key={i.id}>
                <a
                  href={`#${i.id}`}
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  {i.label}
                </a>
              </li>
            ))}
            <li>
              <Link
                to="/terms"
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                Terms of use
              </Link>
            </li>
            <li>
              <Link
                to="/standards"
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                Moderation standard
              </Link>
            </li>
            <li>
              <Link
                to="/illegal-content"
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                Report illegal content
              </Link>
            </li>
          </ol>
        </AsideCard>
      }
      asideLabel="On this page"
    >
      {legal.isError ? (
        <Alert tone="serious" title="The legal notices could not be loaded.">
          {legal.error.message}
        </Alert>
      ) : null}
      {legal.isPending ? <p role="status">Loading…</p> : null}
      {legal.isSuccess ? (
        <Prose>
          <Notice
            id="imprint"
            title="Imprint"
            text={legal.data.impressum}
            missing="The operator of this site has not published an imprint yet."
          />
          <Notice
            id="privacy"
            title="Privacy policy"
            text={legal.data.privacy}
            missing="The operator of this site has not published a privacy policy yet."
          />
        </Prose>
      ) : null}
      <p>
        What gets published here, and who decides, is in the{' '}
        <Link to="/standards" className="underline underline-offset-2">
          moderation standard
        </Link>
        .
      </p>
    </PublicPage>
  );
}
