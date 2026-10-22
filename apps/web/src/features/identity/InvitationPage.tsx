/**
 * The invitee's side: reached only from the link in an email (account.md
 * §06).
 *
 * LOOKING IS NOT ACCEPTING. The page says which organization, which role,
 * who invited them and what that role can and cannot see, before anything
 * is pressed. Accepting needs the invited address signed in, so the page
 * answers each of the three ways somebody can arrive:
 *   - signed in as the invited address: one button, "Accept the invitation";
 *   - signed out: a link to sign in that comes straight back here;
 *   - signed in as somebody else: says so, and offers to sign out, with no
 *     accept button at all (the server would refuse it anyway).
 */
import { acceptInvitation, describeInvitation } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert } from '@/components/ui/alert.tsx';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Page } from '@/components/ui/page.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { call } from '../../lib/api.ts';
import { useIdentityChanged, useMe, useSignOut } from './session.ts';
import { ErrorText, messageOf } from './ui.tsx';

const until = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function InvitationPage({ token }: { token: string }) {
  const me = useMe();
  const changed = useIdentityChanged();
  const signOut = useSignOut();
  const siteName = plainSiteName(useSite().data);
  const offer = useQuery({
    queryKey: ['identity', 'invitation', token],
    queryFn: ({ signal }) => call(describeInvitation, { params: { token }, signal }),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => call(acceptInvitation, { params: { token } }),
    onSuccess: changed,
  });

  if (offer.isPending) return <p role="status">Checking this link…</p>;
  if (accept.isSuccess) {
    return (
      <Page eyebrow={siteName} title="Welcome" width="prose">
        <Alert tone="done">
          You are now a {accept.data.role} of {accept.data.organization}.
        </Alert>
        <p>
          <Link to="/access" className="underline">
            Go to your account
          </Link>
        </p>
      </Page>
    );
  }
  if (offer.isError) {
    return (
      <Page eyebrow={siteName} title="This invitation is not open" width="prose">
        <p>{messageOf(offer.error)}</p>
      </Page>
    );
  }
  const o = offer.data;
  const role = o.permissions.label.toLowerCase();
  const signedInAs = me.data?.signedIn ? me.data.email : null;

  return (
    <Page
      eyebrow={siteName}
      title={`Join ${o.organization} as ${role}`}
      lede={
        <>
          {o.invitedBy} invited <strong>{o.email}</strong>. The invitation lasts until{' '}
          {until(o.expiresAt)}.
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card variant="quiet" heading={`A ${role} can`}>
          <ul className="list-disc space-y-1 pl-6">
            {o.permissions.can.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Card>
        <Card variant="quiet" heading={`A ${role} cannot`}>
          <ul className="list-disc space-y-1 pl-6">
            {o.permissions.cannot.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Card>
      </div>
      {me.isPending ? null : signedInAs && same(signedInAs, o.email) ? (
        <div className="flex flex-col gap-3">
          <p>
            You are signed in as <strong>{signedInAs}</strong>.
          </p>
          <ErrorText error={accept.error} />
          <div>
            <Button
              type="button"
              busy={accept.isPending}
              busyLabel="Accepting…"
              onClick={() => {
                accept.mutate();
              }}
            >
              Accept the invitation
            </Button>
          </div>
        </div>
      ) : signedInAs ? (
        <div className="flex flex-col gap-3">
          <Alert tone="warning">
            You are signed in as <strong>{signedInAs}</strong>, but this invitation is for{' '}
            <strong>{o.email}</strong>.
          </Alert>
          <ErrorText error={signOut.error} />
          <div>
            <Button
              type="button"
              variant="secondary"
              busy={signOut.isPending}
              busyLabel="Signing out…"
              onClick={() => {
                signOut.mutate();
              }}
            >
              Sign out and use the invited address
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>
            To accept, sign in with the invited address. If you were not expecting this, you can
            ignore it: nothing happens and nobody is told.
          </p>
          <div>
            <Link
              to="/access/sign-in"
              search={{ next: `/access/invitation/${token}` }}
              className={buttonVariants({ variant: 'primary' })}
            >
              Sign in as {o.email}
            </Link>
          </div>
        </div>
      )}
    </Page>
  );
}
