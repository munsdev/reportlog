/**
 * Where the erase link in the confirmation email lands: /file/erase/:token.
 *
 * OPENING THE LINK ERASES NOTHING. Mail scanners and link previews open
 * links, so looking is a GET and erasing is the button. The page says what
 * will happen and, as plainly, what will not: the report is not withdrawn.
 *
 * On a door this page calls only the two erase calls.
 */
import { lookEraseLink, eraseViaLink } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiRequestError, call } from '@/lib/api.ts';
import { Narrow, TokenPage } from '@/mockup/Narrow.tsx';
import { Note } from '@/mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { useBodyClass } from '@/mockup/useBodyClass.ts';

const lookQuery = (token: string) =>
  queryOptions({
    queryKey: ['erase-link', token],
    queryFn: ({ signal }) => call(lookEraseLink, { params: { token }, signal }),
    retry: false,
  });

/** Mock-up t-erase.html. */
export function ErasePage({ token }: { token: string }) {
  useBodyClass('light', 'form');
  const look = useQuery(lookQuery(token));
  const [sure, setSure] = useState(false);
  const erase = useMutation({
    mutationFn: () => call(eraseViaLink, { params: { token }, body: { confirm: true } }),
  });

  if (look.isPending) {
    return (
      <Narrow>
        <p role="status" className="muted">
          Checking this link…
        </p>
      </Narrow>
    );
  }
  if (look.isError) {
    const missing = look.error instanceof ApiRequestError && look.error.status === 404;
    return (
      <TokenPage title="This link does not match anything">
        <p>
          {missing
            ? 'Either the whole link was not copied, or your contact details have already been erased.'
            : look.error.message}
        </p>
      </TokenPage>
    );
  }
  if (erase.isSuccess) {
    return (
      <TokenPage eyebrow={look.data.logbook_title} title="Your contact details are erased">
        <Note>
          The key your email address was kept under is destroyed. Nobody can read it again, and
          nobody can reach you about this report. Your report itself is unchanged.
        </Note>
      </TokenPage>
    );
  }
  if (look.data.state === 'not_yet_filed') {
    return (
      <TokenPage eyebrow={look.data.logbook_title} title="Nothing to erase yet">
        <p>
          Your report has not been filed, so this site holds nothing but the message it sent you. If
          you do not want to file it, ignore that email: the link in it stops working on its own.
        </p>
      </TokenPage>
    );
  }
  return (
    <TokenPage eyebrow={look.data.logbook_title} title="Erase your contact details">
      {look.data.public_ref ? <p className="m">For your report {look.data.public_ref}</p> : null}
      <p>
        Pressing the button destroys the key your email address is kept under. After that nobody,
        including the people who run this site, can read your address or write to you about this
        report. This cannot be undone.
      </p>
      <Panel kind="deep" title="What this does not do">
        <p>
          Your report is not withdrawn. It stays exactly as it is, sealed, and is published or not
          as before. If you want it taken down, withdraw it from “My reports” first.
        </p>
      </Panel>
      {erase.isError ? (
        <Note warn title="It was not erased.">
          {erase.error.message}
        </Note>
      ) : null}
      <label className="check">
        <input
          id="erase-sure"
          type="checkbox"
          checked={sure}
          onChange={(e) => {
            setSure(e.target.checked);
          }}
        />
        I understand this cannot be undone.
      </label>
      {/* A destructive action is never the action colour; it says why it waits. */}
      <div>
        <button
          className="btn sm flat bad"
          type="button"
          disabled={!sure || erase.isPending}
          aria-describedby={sure ? undefined : 'erase-why'}
          onClick={() => {
            erase.mutate();
          }}
        >
          {erase.isPending ? 'Erasing…' : 'Erase my details'}
        </button>
        {sure ? null : (
          <p id="erase-why" className="m">
            Tick the statement above first.
          </p>
        )}
      </div>
    </TokenPage>
  );
}
