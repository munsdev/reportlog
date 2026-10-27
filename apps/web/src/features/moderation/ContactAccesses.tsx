/**
 * For "My reports": every time somebody on staff opened this report's
 * contact details or a file's unstripped original, or had the site open your
 * address to ask you for files, and the reason they gave. Never who: naming a volunteer to
 * a reporter unhappy with a decision is a risk to that volunteer, and the
 * server does not send it.
 */
import { getMyReportAccesses } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Panel } from '@/mockup/Panel.tsx';

const WHAT: Record<string, string> = {
  contact: 'Your contact details were opened',
  contact_used: 'Your address was opened to email you a request for files',
  file_original: 'The original of a file you sent was opened',
};

const accessesQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['mine', threadId, 'accesses'],
    queryFn: ({ signal }) => call(getMyReportAccesses, { params: { threadId }, signal }),
  });

export function ContactAccesses({ threadId }: { threadId: string }) {
  const query = useQuery(accessesQuery(threadId));
  return (
    <Panel title="Who opened your details">
      <ErrorLine error={query.error} />
      {query.data ? (
        query.data.accesses.length === 0 ? (
          <p className="muted">
            Nobody on staff has opened your contact details or the originals of your files.
          </p>
        ) : (
          <>
            <p className="muted">
              Each time somebody on staff opened your contact details or the original of a file you
              sent, or had the site open your address to ask you for files, and the reason they
              gave. Their name is kept for the site’s administrators.
            </p>
            {query.data.accesses.map((a, i) => (
              <p key={`${a.what}-${a.accessed_at}-${String(i)}`}>
                <b>{new Date(a.accessed_at).toLocaleString()}</b>: {WHAT[a.what] ?? 'Opened'}
                {a.reason ? `. The reason given: ${a.reason}` : '.'}
              </p>
            ))}
          </>
        )
      ) : null}
    </Panel>
  );
}
