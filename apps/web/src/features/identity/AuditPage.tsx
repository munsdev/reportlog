/**
 * Who changed what: the role trail, newest first. It cannot be edited, by
 * anybody, which is the only reason it is worth reading.
 */
import { listAudit } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';
import { ErrorText } from './ui.tsx';

export function AuditPage() {
  const me = useMe();
  const audit = useQuery({
    queryKey: ['identity', 'audit'],
    queryFn: ({ signal }) => call(listAudit, { signal }),
    enabled: me.data?.signedIn === true,
  });
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next="/access/audit" />;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Who changed what</h1>
      <p className="text-ink-alt">
        Every change to who may do what, and every copy of the whole archive taken off the server,
        as it was made. Nothing here can be edited or removed.
      </p>
      <ErrorText error={audit.error} />
      {audit.data && (
        <ol className="space-y-3">
          {audit.data.entries.map((e, i) => (
            <li key={i} className="border-b border-line pb-3">
              {e.action === 'download' ? (
                // A copy of the whole archive taken off the server (the
                // owner's backups and exports): nobody else is its subject.
                <p>
                  <span className="break-all font-semibold">{e.actor_email}</span> downloaded{' '}
                  {e.detail}
                </p>
              ) : (
                <p>
                  <span className="break-all font-semibold">{e.actor_email}</span>{' '}
                  {e.action === 'grant'
                    ? 'gave'
                    : e.action === 'revoke'
                      ? 'took from'
                      : 'changed, for'}{' '}
                  <span className="break-all font-semibold">{e.subject_email}</span>: {e.detail}
                  {e.organization ? ` (${e.organization})` : ''}
                </p>
              )}
              <p className="text-sm text-muted">
                <time dateTime={e.created_at}>{new Date(e.created_at).toUTCString()}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
