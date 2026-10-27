/**
 * For journalists: /journalists. A page of choices and nothing else, so it
 * makes no calls of its own beyond the site's (it is safe on a door page,
 * where the footer is drawn). Both choices lead to the one sign-up form
 * (owner decision 69); the second arrives with the desk-access box already
 * ticked. The mock-up's journalists.html: band, numbered sections beside
 * side cards, then the Follow along band.
 */
import { Link } from '@tanstack/react-router';
import { Band, MockPage } from '../../mockup/Band.tsx';
import { SecHead } from '../../mockup/SecHead.tsx';
import { Card, TwoCol } from '../../mockup/TwoCol.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { FollowBand } from '../follow/FollowBand.tsx';

export function JournalistsLanding() {
  useBodyClass('light');
  return (
    <MockPage>
      <Band
        eyebrow="For journalists and researchers"
        title={'The record,\non your desk'}
        tabTitle="For journalists"
        lead="Get an email when new approved reports appear in the states you cover, or ask to read the links moderators have checked."
        motif
      />
      <TwoCol
        asideLabel="Related"
        aside={
          <>
            <Card title="The numbers">
              <p>Counts by type and by day, with the publication timestamp.</p>
              <Link className="btn sm flat" to="/board/numbers">
                Numbers
              </Link>
            </Card>
            <Card title="Public API" plain>
              <p>Published reports as JSON, plus the transparency log.</p>
              <Link className="btn sm flat" to="/how" search={{ tab: 'developers' }}>
                For developers
              </Link>
            </Card>
            <Card title="Check a report" plain>
              <p>Confirm in your browser that a report has not been changed since it was filed.</p>
              <Link className="btn sm flat" to="/verify">
                Check
              </Link>
            </Card>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 34 }}>
          <section id="alerts" aria-labelledby="a1">
            <SecHead num="01" id="a1" title="Get alerts">
              One email when new approved reports appear in the states you choose. Counts only, no
              characterization. Anyone can join.
            </SecHead>
            <div className="btn-row">
              <Link className="btn go" to="/journalists/alerts">
                Sign up for alerts
              </Link>
            </div>
          </section>
          <section aria-labelledby="a2">
            <SecHead num="02" id="a2" title="Desk access">
              The journalist desk lists links moderators have checked, and the sources they cite on
              published reports. The owner reads every request; nothing is approved automatically.
            </SecHead>
            <div className="btn-row">
              <Link className="btn" to="/journalists/alerts" search={{ access: '1' }}>
                Apply for desk access
              </Link>
              <Link className="btn ghost" to="/standards">
                Read the standard
              </Link>
            </div>
          </section>
          <section id="press" aria-labelledby="a3">
            <SecHead num="03" id="a3" title="Press">
              Documents for reporters, when the operator has published any, are in the press pack on
              the board.
            </SecHead>
            <div className="btn-row">
              <Link className="btn" to="/board/press">
                Press pack
              </Link>
            </div>
          </section>
        </div>
      </TwoCol>
      <FollowBand placement="journalists" bleed />
    </MockPage>
  );
}
