/**
 * For journalists: /journalists. A page of choices and nothing else, so it
 * makes no calls of its own (it is safe on a door page, where the footer is
 * drawn). Both cards lead to the one sign-up form (owner decision 69); the
 * second arrives with the desk-access box already ticked.
 */
import { Link } from '@tanstack/react-router';
import { Card } from '@/components/ui/card.tsx';
import { PublicPage } from '../site-pages/PublicPage.tsx';

export function JournalistsLanding() {
  return (
    <PublicPage
      title="For journalists"
      width="prose"
      lede="Get an email when new approved reports appear in the states you cover, or ask to read the links moderators have checked."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Card heading="Get alerts">
          <p>
            An email when new approved reports appear in the states you choose. It says how many,
            and nothing more. Anyone can join.
          </p>
          <p>
            <Link to="/journalists/alerts" className="underline underline-offset-2">
              Sign up for alerts
            </Link>
          </p>
        </Card>
        <Card heading="Apply for desk access">
          <p>
            The journalist desk lists links moderators have checked, and the sources they cite on
            published reports. The owner reads every request; nothing is approved automatically.
          </p>
          <p>
            <Link
              to="/journalists/alerts"
              search={{ access: '1' }}
              className="underline underline-offset-2"
            >
              Apply for desk access
            </Link>
          </p>
        </Card>
      </div>
      <p>
        Already approved?{' '}
        <Link
          to="/access/sign-in"
          search={{ next: '/desk' }}
          className="underline underline-offset-2"
        >
          Sign in
        </Link>{' '}
        with your address, type the code we email you, accept the agreement, and the desk opens.
      </p>
    </PublicPage>
  );
}
