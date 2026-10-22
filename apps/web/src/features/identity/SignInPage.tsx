import { useRouter } from '@tanstack/react-router';
import { BrandName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow, Lede } from '@/components/ui/type.tsx';
import { SignInForm } from './SignInForm.tsx';
import { useIdentityChanged } from './session.ts';

/**
 * /access/sign-in (account.md §02). `next` is where to go afterwards: a path
 * on this site, never another one.
 */
export function SignInPage({ next }: { next: string | undefined }) {
  const router = useRouter();
  const changed = useIdentityChanged();
  const site = useSite();
  return (
    <section className="flex max-w-prose flex-col gap-4">
      <Eyebrow>{site.data ? <BrandName parts={site.data.name_parts} /> : 'ReportLog'}</Eyebrow>
      <h1 className="font-display text-title font-bold">Sign in</h1>
      <Lede>We email you a code. No password to remember.</Lede>
      <SignInForm
        onSignedIn={async (me) => {
          await changed();
          router.history.push(next ?? (me.signedIn && me.grantsAccess ? '/access' : '/'));
        }}
      />
      <p className="text-sm text-ink-alt">
        Staff then confirm with an authenticator app or a passkey.
      </p>
    </section>
  );
}

/** Only a path on this site: a `next` of "//elsewhere" or "https://…" would send somebody away. */
export function safeNext(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : undefined;
}
