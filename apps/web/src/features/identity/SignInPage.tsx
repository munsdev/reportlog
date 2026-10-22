import { useRouter } from '@tanstack/react-router';
import { SignInForm } from './SignInForm.tsx';
import { useIdentityChanged } from './session.ts';

/** /access/sign-in. `next` is where to go afterwards: a path on this site, never another one. */
export function SignInPage({ next }: { next: string | undefined }) {
  const router = useRouter();
  const changed = useIdentityChanged();
  return (
    <section className="max-w-xl space-y-6">
      <h1 className="font-display text-title font-bold">Sign in</h1>
      <SignInForm
        intro="There is no password. We email you a code each time, so only somebody holding your mailbox can sign in as you."
        onSignedIn={async (me) => {
          await changed();
          router.history.push(next ?? (me.signedIn && me.grantsAccess ? '/access' : '/'));
        }}
      />
    </section>
  );
}

/** Only a path on this site: a `next` of "//elsewhere" or "https://…" would send somebody away. */
export function safeNext(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : undefined;
}
