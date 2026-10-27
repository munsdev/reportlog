import { Link } from '@tanstack/react-router';
import { TokenPage } from '../../mockup/Narrow.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';

/** Shown where a page needs an account: the mock-up's narrow light page. */
export function SignInPrompt({ next }: { next: string }) {
  useBodyClass('light', 'form');
  return (
    <TokenPage eyebrow="Sign in" title="Sign in first">
      <p>
        This page is for people with an account.{' '}
        <Link to="/access/sign-in" search={{ next }}>
          Sign in
        </Link>{' '}
        and you will come straight back here.
      </p>
    </TokenPage>
  );
}
