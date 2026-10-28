/**
 * Get involved (mock-up get-involved.html): the Follow along band at the top
 * (placement `get_involved`, an owner's switch), then the ways to help the
 * operator has opened. Every card is a list an administrator opened to
 * anybody (`/api/lists`), so the page promises nothing the site does not
 * run: no list open, no card, only the sharing section.
 */
import { listOpenLists } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { FollowBand } from '../features/follow/FollowBand.tsx';
import { call } from '../lib/api.ts';
import { MockPage } from '../mockup/Band.tsx';
import { CopyBox } from '../mockup/CopyBox.tsx';
import { SecHead } from '../mockup/SecHead.tsx';
import { useBodyClass } from '../mockup/useBodyClass.ts';
import { usePageTitle } from '../mockup/usePageTitle.ts';

export const Route = createFileRoute('/get-involved')({
  component: GetInvolvedPage,
});

function GetInvolvedPage() {
  const site = plainSiteName(useSite().data);
  const lists = useQuery({
    queryKey: ['open-lists'],
    queryFn: ({ signal }) => call(listOpenLists, { signal }),
  });
  const address = typeof window === 'undefined' ? '' : window.location.origin;
  const rows = lists.data?.lists ?? [];
  useBodyClass('dark');
  usePageTitle('Get involved');
  return (
    <MockPage>
      <FollowBand placement="get_involved" bleed />
      <section className="hero motif-host" aria-labelledby="h1">
        <div className="ov" data-slot="hero" />
        <div className="wrap">
          <span className="eyebrow">Get involved</span>
          <h1 className="display" id="h1" style={{ fontSize: 'clamp(2.8rem,10vw,7rem)' }}>
            Help it
            <br />
            <span className="two">get seen</span>
          </h1>
          <p className="lede">
            {site} works when people know it exists and someone reads every report. Here is what
            that takes.
          </p>
        </div>
      </section>
      <div className="wrap">
        {rows.length ? (
          <section className="section" aria-labelledby="s1">
            <SecHead num="01" id="s1" title="Ways to help" />
            <div className="cards">
              {rows.map((l) => (
                <div className="card" key={l.slug}>
                  <h3>{l.title}</h3>
                  {l.blurb ? <p>{l.blurb}</p> : null}
                  <Link className="btn sm flat" to="/list/$slug" params={{ slug: l.slug }}>
                    Start
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section className="section" id="share" aria-labelledby="s2">
          <SecHead num={rows.length ? '02' : '01'} id="s2" title="Spread the word">
            Share the address. Anybody who sees something can put it on the record.
          </SecHead>
          <div className="share">
            <CopyBox text={address} what="the site address" code={address || site} />
          </div>
        </section>
      </div>
    </MockPage>
  );
}
