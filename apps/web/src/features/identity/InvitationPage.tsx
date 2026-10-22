/**
 * The invitee's side: reached only from the link in an email.
 *
 * LOOKING IS NOT ACCEPTING. The page says which organization, which role,
 * who invited them and what that role can and cannot see, before anything
 * is pressed. Accepting needs the invited address signed in.
 */
import { acceptInvitation, describeInvitation } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { useIdentityChanged, useMe } from './session.ts';
import { Done, ErrorText } from './ui.tsx';

export function InvitationPage({ token }: { token: string }) {
  const me = useMe();
  const changed = useIdentityChanged();
  const offer = useQuery({
    queryKey: ['identity', 'invitation', token],
    queryFn: ({ signal }) => call(describeInvitation, { params: { token }, signal }),
  });
  const accept = useMutation({
    mutationFn: () => call(acceptInvitation, { params: { token } }),
    onSuccess: changed,
  });

  if (offer.isPending) return <p role="status">Loading…</p>;
  if (offer.isError && !accept.isSuccess) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-bold">This invitation is not open</h1>
        <ErrorText error={offer.error} />
      </section>
    );
  }
  if (accept.isSuccess) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-bold">Welcome</h1>
        <Done>
          You are now a {accept.data.role} of {accept.data.organization}.
        </Done>
        <Link to="/access" className="underline">
          Go to your account
        </Link>
      </section>
    );
  }
  const o = offer.data;
  if (!o) return null;
  const signedInAs = me.data?.signedIn ? me.data.email : null;

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-title font-bold">
          Join {o.organization} as {o.permissions.label.toLowerCase()}
        </h1>
        <p className="text-ink-alt">
          {o.invitedBy} invited <strong>{o.email}</strong>. The invitation lasts until{' '}
          {new Date(o.expiresAt).toUTCString()}.
        </p>
      </header>
      <div className="grid gap-6 sm:grid-cols-2">
        <section aria-labelledby="can">
          <h2 id="can" className="font-display text-lg font-bold">
            A {o.permissions.label.toLowerCase()} can
          </h2>
          <ul className="list-disc space-y-1 pl-6">
            {o.permissions.can.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="cannot">
          <h2 id="cannot" className="font-display text-lg font-bold">
            A {o.permissions.label.toLowerCase()} cannot
          </h2>
          <ul className="list-disc space-y-1 pl-6">
            {o.permissions.cannot.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      </div>
      {signedInAs ? (
        <div className="space-y-3">
          <p>
            You are signed in as <strong>{signedInAs}</strong>.
          </p>
          <ErrorText error={accept.error} />
          <Button
            type="button"
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate();
            }}
          >
            Accept the invitation
          </Button>
        </div>
      ) : (
        <p>
          To accept,{' '}
          <Link
            to="/access/sign-in"
            search={{ next: `/access/invitation/${token}` }}
            className="underline"
          >
            sign in as {o.email}
          </Link>
          . If you were not expecting this, you can ignore it: nothing happens and nobody is told.
        </p>
      )}
    </article>
  );
}
