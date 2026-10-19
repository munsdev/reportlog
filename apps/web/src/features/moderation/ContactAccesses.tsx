/**
 * For "My reports": every time somebody on staff opened this report's
 * contact details or a file's unstripped original, and the reason they gave. Never who: naming a volunteer to
 * a reporter unhappy with a decision is a risk to that volunteer, and the
 * server does not send it.
 */
import { getMyReportAccesses } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { call } from '../../lib/api.ts';

const accessesQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['mine', threadId, 'accesses'],
    queryFn: ({ signal }) => call(getMyReportAccesses, { params: { threadId }, signal }),
  });

export function ContactAccesses({ threadId }: { threadId: string }) {
  const query = useQuery(accessesQuery(threadId));
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 id={id} className="font-display text-xl font-bold">
        Who looked at your details
      </h2>
      {query.isError ? <p>{query.error.message}</p> : null}
      {query.data ? (
        query.data.accesses.length === 0 ? (
          <p>Nobody on staff has opened your contact details or the originals of your files.</p>
        ) : (
          <>
            <p className="text-sm text-ink-alt">
              Each time somebody on staff opened your contact details or the original of a file you
              sent, and the reason they had to give. Their name is kept for the site’s
              administrators.
            </p>
            <ul className="flex flex-col gap-2">
              {query.data.accesses.map((a, i) => (
                <li key={`${a.what}-${a.accessed_at}-${String(i)}`}>
                  <span className="font-semibold">{new Date(a.accessed_at).toLocaleString()}</span>:{' '}
                  {a.reason}
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </section>
  );
}
