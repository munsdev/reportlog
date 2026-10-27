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
import { BandPage, SecHead } from '../components/ui/band.tsx';
import { Button } from '../components/ui/button.tsx';
import { CopyBox } from '../features/site-pages/CopyBox.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { FollowBand } from '../features/follow/FollowBand.tsx';
import { call } from '../lib/api.ts';

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
  return (
    <>
      <FollowBand placement="get_involved" bleed />
      <BandPage
        title="Get involved"
        heading={'Help it\nget seen'}
        eyebrow="Get involved"
        lede={`${site} works when people know it exists and someone reads every report. Here is what that takes.`}
        className="gap-10"
      >
        {rows.length ? (
          <section aria-labelledby="ways">
            <SecHead num="01" title="Ways to help" id="ways" />
            <ul className="grid gap-4 min-[820px]:grid-cols-3">
              {rows.map((l) => (
                <li
                  key={l.slug}
                  className="grid content-start gap-2.5 rounded-card border-(length:--rl-border-main) border-ink bg-surface p-[18px] shadow-raised"
                >
                  <h3 className="font-display text-[1.35rem] leading-none">{l.title}</h3>
                  {l.blurb ? <p className="text-[0.95rem] text-ink-alt">{l.blurb}</p> : null}
                  <Button asChild variant="secondary" className="mt-1 justify-self-start">
                    <Link to="/list/$slug" params={{ slug: l.slug }}>
                      Sign up
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section id="share" aria-labelledby="share-h" className="max-w-[62ch]">
          <SecHead num={rows.length ? '02' : '01'} title="Spread the word" id="share-h">
            Share the address. Anybody who sees something can put it on the record.
          </SecHead>
          <CopyBox text={address} what="the site address" code={address || site} />
        </section>
      </BandPage>
    </>
  );
}
