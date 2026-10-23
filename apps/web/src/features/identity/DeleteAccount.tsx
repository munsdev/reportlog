/**
 * Deleting your own account, at the foot of "Your account" (identity/account.ts
 * on the server says what goes and what stays).
 *
 * The address typed back is the confirmation, beside the same "cannot be
 * undone" box as erasing a report's contact details. A role holder is asked
 * for their second factor as well; the API client asks for it when the server
 * says so. The owner is told why not, and where the handover is.
 */
import { deleteAccount } from '@reportlog/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { call } from '../../lib/api.ts';
import type { SignedInMe } from './session.ts';
import { ErrorText, Panel, TextField } from './ui.tsx';

export function DeleteAccount({ me }: { me: SignedInMe }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const [sure, setSure] = useState(false);
  const go = useMutation({
    mutationFn: () => call(deleteAccount, { body: { email: typed } }),
    onSuccess: async () => {
      await navigate({ to: '/', search: { account: 'deleted' } });
      // After leaving the page, so nothing here redraws as "signed out".
      client.clear();
    },
  });

  if (me.heldRoles.includes('owner')) {
    return (
      <Panel title="Delete your account">
        <p>
          You hold the owner’s seat, so your account cannot be deleted: a deployment always has one
          owner.{' '}
          <Link to="/access" hash="owner-seat" className="underline">
            Hand it on
          </Link>{' '}
          to somebody else first. Then you can delete your account here.
        </p>
      </Panel>
    );
  }

  const matches = typed.trim().toLowerCase() === me.email;
  return (
    <Panel title="Delete your account">
      <p>
        This deletes your address from this site, signs you out everywhere, and removes your second
        factor, your place in any organization, and your email updates. Signing in again later with
        the same address starts a new, empty account.
      </p>
      <p className="text-ink-alt">
        Reports you already filed stay: they are sealed, and deleting your account does not withdraw
        them. To erase the contact details kept with a report, use{' '}
        <Link to="/mine" className="underline">
          My reports
        </Link>{' '}
        before you delete your account. If you held a role, what you did in it stays on the record
        under your address, because that is how staff are held to account.
      </p>
      <TextField
        label="Type your email address to confirm"
        type="email"
        autoComplete="off"
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
        }}
      />
      <CheckOption
        id="delete-account-sure"
        label="I understand this cannot be undone."
        checked={sure}
        onCheckedChange={(on) => {
          setSure(on === true);
        }}
      />
      <ErrorText error={go.error} />
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={!sure || !matches || go.isPending}
          onClick={() => {
            go.mutate();
          }}
        >
          {go.isPending ? 'Deleting…' : 'Delete my account'}
        </Button>
      </div>
      {!matches && typed.trim() ? (
        <p className="text-sm text-ink-alt">That is not the address you are signed in with.</p>
      ) : null}
    </Panel>
  );
}
