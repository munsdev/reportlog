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
import { call } from '../../lib/api.ts';
import { Narrow, TokenPage } from '../../mockup/Narrow.tsx';
import { ErrorNote, Note, Waiting } from '../../mockup/Panel.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { useIdentityChanged, useMe, useSignOut } from './session.ts';
import { messageOf } from './ui.tsx';

const until = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Mock-up t-invite.html. */
export function InvitationPage({ token }: { token: string }) {
  useBodyClass('light', 'form');
  const me = useMe();
  const changed = useIdentityChanged();
  const signOut = useSignOut();
  const offer = useQuery({
    queryKey: ['identity', 'invitation', token],
    queryFn: ({ signal }) => call(describeInvitation, { params: { token }, signal }),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => call(acceptInvitation, { params: { token } }),
    onSuccess: changed,
  });

  if (offer.isPending) {
    return (
      <Narrow>
        <Waiting>Checking this link…</Waiting>
      </Narrow>
    );
  }
  if (accept.isSuccess) {
    return (
      <TokenPage title="Welcome">
        <Note>
          You are now a {accept.data.role} of {accept.data.organization}.
        </Note>
        <p>
          <Link to="/access">Go to your account</Link>
        </p>
      </TokenPage>
    );
  }
  if (offer.isError) {
    return (
      <TokenPage title="This invitation is not open">
        <p>{messageOf(offer.error)}</p>
      </TokenPage>
    );
  }
  const o = offer.data;
  const role = o.permissions.label.toLowerCase();
  const signedInAs = me.data?.signedIn ? me.data.email : null;

  return (
    <TokenPage title={`Join ${o.organization} as ${role}`}>
      <p>
        {o.invitedBy} invited {o.email}. The invitation lasts until {until(o.expiresAt)}.
      </p>
      <div className="cards two">
        <div className="card plain">
          <h3>{`A ${role} can`}</h3>
          <ul style={{ paddingLeft: 24, listStyle: 'disc' }}>
            {o.permissions.can.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <div className="card plain">
          <h3>{`A ${role} cannot`}</h3>
          <ul style={{ paddingLeft: 24, listStyle: 'disc' }}>
            {o.permissions.cannot.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>
      {me.isPending ? null : signedInAs && same(signedInAs, o.email) ? (
        <>
          <p className="m">You are signed in as {signedInAs}.</p>
          <ErrorNote error={accept.error} />
          <div>
            <button
              className="btn sm flat go"
              type="button"
              disabled={accept.isPending}
              onClick={() => {
                accept.mutate();
              }}
            >
              {accept.isPending ? 'Accepting…' : 'Accept the invitation'}
            </button>
          </div>
        </>
      ) : signedInAs ? (
        <>
          <Note warn>
            You are signed in as {signedInAs}, but this invitation is for {o.email}.
          </Note>
          <ErrorNote error={signOut.error} />
          <div>
            <button
              className="btn sm flat"
              type="button"
              disabled={signOut.isPending}
              onClick={() => {
                signOut.mutate();
              }}
            >
              {signOut.isPending ? 'Signing out…' : 'Sign out and use the invited address'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            To accept, sign in with the invited address. If you were not expecting this, you can
            ignore it: nothing happens and nobody is told.
          </p>
          <div>
            <Link
              to="/access/sign-in"
              search={{ next: `/access/invitation/${token}` }}
              className="btn sm flat go"
            >
              Sign in as {o.email}
            </Link>
          </div>
        </>
      )}
    </TokenPage>
  );
}
