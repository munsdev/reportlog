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
import { Note } from '@/mockup/Note.tsx';
import { call } from '../lib/api.ts';
import { Band, MockPage } from '../mockup/Band.tsx';
import { Card, TwoCol } from '../mockup/TwoCol.tsx';
import { useBodyClass } from '../mockup/useBodyClass.ts';

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
    <>
      <h2 id={id}>{title}</h2>
      {text ? (
        <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
      ) : (
        <>
          <p>
            <b>Not written yet.</b>
          </p>
          <p>{missing}</p>
        </>
      )}
    </>
  );
}

function LegalPage() {
  const legal = useQuery(legalQuery);
  useBodyClass('light');
  return (
    <MockPage>
      <Band eyebrow="Legal" title={'Imprint and\nprivacy'} tabTitle="Imprint and privacy" />
      <TwoCol
        pad={30}
        asideLabel="On this page"
        aside={
          <Card title="On this page" plain>
            <ol className="steps" style={{ gap: 6 }}>
              <li>
                <a href="#imprint">Imprint</a>
              </li>
              <li>
                <a href="#privacy">Privacy policy</a>
              </li>
              <li>
                <Link to="/terms">Terms of use</Link>
              </li>
              <li>
                <Link to="/standards">Moderation standard</Link>
              </li>
              <li>
                <Link to="/illegal-content">Report illegal content</Link>
              </li>
            </ol>
          </Card>
        }
      >
        <div className="prose">
          {legal.isError ? (
            <Note tone="serious" title="The legal notices could not be loaded.">
              {legal.error.message}
            </Note>
          ) : null}
          {legal.isPending ? <p role="status">Loading…</p> : null}
          {legal.isSuccess ? (
            <>
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
            </>
          ) : null}
          <p>
            What gets published here, and who decides, is in the{' '}
            <Link to="/standards">moderation standard</Link>.
          </p>
        </div>
      </TwoCol>
    </MockPage>
  );
}
