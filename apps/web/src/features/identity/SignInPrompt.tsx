import { Link } from '@tanstack/react-router';

/** What a page for signed-in people shows to somebody who is not. */
export function SignInPrompt({ next }: { next: string }) {
  return (
    <section className="space-y-3">
      <h1 className="font-display text-2xl font-bold">Sign in first</h1>
      <p>
        This page is for people with an account.{' '}
        <Link to="/access/sign-in" search={{ next }} className="underline">
          Sign in
        </Link>{' '}
        and you will come straight back here.
      </p>
    </section>
  );
}
