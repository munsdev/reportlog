/**
 * A logbook's or a list's form at the root of the site (electionlog.org/volunteer).
 * Every page the site has wins over this route, and the server refuses a
 * slug that names one (RESERVED_SLUGS), so the two cannot collide.
 *
 * Which of the two it is gets found by asking the list read first. That read
 * is made outside the query cache on purpose: on a site with a password, a
 * logbook's slug answers "locked" to a visitor without it, and the cache's
 * locked handler would send them to the password screen from a logbook that
 * is open to them. Anything that is not a list falls through to the logbook
 * form, which says "not found" itself. A logbook's short address (short_slug)
 * resolves to its real slug first, and the form files under the real one.
 */
import { getListForm, getMap, getPublicLogbook } from '@reportlog/contracts';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { FilingForm } from '../features/form/FilingForm.tsx';
import { FormColumn } from '../features/form/FormNotice.tsx';
import { MapPage } from '../features/maps/MapPage.tsx';
import { ListFormPage } from '../features/lists/ListForm.tsx';
import { call } from '../lib/api.ts';

export const Route = createFileRoute('/$slug')({
  component: RootSlugPage,
});

function RootSlugPage() {
  const { slug } = Route.useParams();
  const { history } = useRouter();
  const [found, setFound] = useState<{
    slug: string;
    kind: 'list' | 'logbook' | 'map';
    real: string;
  } | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    call(getListForm, { params: { slug }, signal: ac.signal }).then(
      () => {
        setFound({ slug, kind: 'list', real: slug });
      },
      () => {
        if (ac.signal.aborted) return;
        // A logbook may be reached by its short address; the read answers
        // with its real slug, which is what the form files under. Anything
        // else goes on as the address given, and the form says "not found".
        call(getPublicLogbook, { params: { slug }, signal: ac.signal }).then(
          (lb) => {
            setFound({ slug, kind: 'logbook', real: lb.slug });
          },
          () => {
            if (ac.signal.aborted) return;
            // Last, a public map at this address. Nothing found anywhere
            // goes to the logbook form, which says "not found" itself.
            call(getMap, { params: { slug }, signal: ac.signal }).then(
              () => {
                setFound({ slug, kind: 'map', real: slug });
              },
              () => {
                if (!ac.signal.aborted) setFound({ slug, kind: 'logbook', real: slug });
              },
            );
          },
        );
      },
    );
    return () => {
      ac.abort();
    };
  }, [slug]);

  if (found?.slug !== slug) {
    return (
      <FormColumn>
        <p role="status">Opening the form…</p>
      </FormColumn>
    );
  }
  if (found.kind === 'map') return <MapPage slug={slug} start={{}} />;
  return found.kind === 'list' ? (
    <ListFormPage slug={slug} />
  ) : (
    <FilingForm slug={found.real} history={history} />
  );
}
