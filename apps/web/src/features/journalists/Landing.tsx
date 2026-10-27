/**
 * For journalists: /journalists. A page of choices and nothing else, so it
 * makes no calls of its own beyond the site's (it is safe on a door page,
 * where the footer is drawn). Both choices lead to the one sign-up form
 * (owner decision 69); the second arrives with the desk-access box already
 * ticked. Shape from the mock-up: band, numbered sections beside side cards,
 * then the Follow along band.
 */
import { Link } from '@tanstack/react-router';
import { AsideCard, SecHead } from '@/components/ui/band.tsx';
import { Button } from '@/components/ui/button.tsx';
import { FollowBand } from '../follow/FollowBand.tsx';
import { PublicPage } from '../site-pages/PublicPage.tsx';

export function JournalistsLanding() {
  return (
    <>
      <PublicPage
        title="For journalists"
        eyebrow="For journalists and researchers"
        lede="Get an email when new approved reports appear in the states you cover, or ask to read the links moderators have checked."
        aside={
          <>
            <AsideCard title="The numbers">
              <p>Counts by type and by day, with the publication timestamp.</p>
              <Button asChild variant="secondary" className="justify-self-start">
                <Link to="/board/numbers">Numbers</Link>
              </Button>
            </AsideCard>
            <AsideCard title="Public API" plain>
              <p>Published reports as JSON, plus the transparency log.</p>
              <Button asChild variant="secondary" className="justify-self-start">
                <Link to="/how" search={{ tab: 'developers' }}>
                  For developers
                </Link>
              </Button>
            </AsideCard>
            <AsideCard title="Check a report" plain>
              <p>Confirm in your browser that a report has not been changed since it was filed.</p>
              <Button asChild variant="secondary" className="justify-self-start">
                <Link to="/verify">Check</Link>
              </Button>
            </AsideCard>
          </>
        }
        asideLabel="Related"
      >
        <section id="alerts" aria-labelledby="a1">
          <SecHead num="01" title="Get alerts" id="a1">
            One email when new approved reports appear in the states you choose. Counts only, no
            characterization. Anyone can join.
          </SecHead>
          <Button asChild>
            <Link to="/journalists/alerts">Sign up for alerts</Link>
          </Button>
        </section>
        <section aria-labelledby="a2">
          <SecHead num="02" title="Desk access" id="a2">
            The journalist desk lists links moderators have checked, and the sources they cite on
            published reports. The owner reads every request; nothing is approved automatically.
          </SecHead>
          <div className="flex flex-wrap items-center gap-3.5">
            <Button asChild variant="secondary">
              <Link to="/journalists/alerts" search={{ access: '1' }}>
                Apply for desk access
              </Link>
            </Button>
            <Button asChild variant="quiet">
              <Link to="/standards">Read the standard</Link>
            </Button>
          </div>
        </section>
        <section id="press" aria-labelledby="a3">
          <SecHead num="03" title="Press" id="a3">
            Documents for reporters, when the operator has published any, are in the press pack on
            the board.
          </SecHead>
          <Button asChild variant="secondary">
            <Link to="/board/press">Press pack</Link>
          </Button>
        </section>
      </PublicPage>
      <FollowBand placement="journalists" bleed />
    </>
  );
}
