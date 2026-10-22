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
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow, Meta } from '@/components/ui/type.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';

const lookQuery = (token: string) =>
  queryOptions({
    queryKey: ['erase-link', token],
    queryFn: ({ signal }) => call(lookEraseLink, { params: { token }, signal }),
    retry: false,
  });

export function ErasePage({ token }: { token: string }) {
  const look = useQuery(lookQuery(token));
  const [sure, setSure] = useState(false);
  const erase = useMutation({
    mutationFn: () => call(eraseViaLink, { params: { token }, body: { confirm: true } }),
  });

  if (look.isPending) return <p role="status">Checking this link…</p>;
  if (look.isError) {
    const missing = look.error instanceof ApiRequestError && look.error.status === 404;
    return (
      <LinkPage title="This link does not match anything">
        <p className="max-w-prose">
          {missing
            ? 'Either the whole link was not copied, or your contact details have already been erased.'
            : look.error.message}
        </p>
      </LinkPage>
    );
  }
  if (erase.isSuccess) {
    return (
      <LinkPage title="Your contact details are erased" eyebrow={look.data.logbook_title}>
        <Alert tone="done">
          The key your email address was kept under is destroyed. Nobody can read it again, and
          nobody can reach you about this report. Your report itself is unchanged.
        </Alert>
      </LinkPage>
    );
  }
  if (look.data.state === 'not_yet_filed') {
    return (
      <LinkPage title="Nothing to erase yet" eyebrow={look.data.logbook_title}>
        <p className="max-w-prose">
          Your report has not been filed, so this site holds nothing but the message it sent you. If
          you do not want to file it, ignore that email: the link in it stops working on its own.
        </p>
      </LinkPage>
    );
  }
  return (
    <LinkPage title="Erase your contact details" eyebrow={look.data.logbook_title}>
      {look.data.public_ref ? (
        <p>
          For your report <Meta className="text-base text-ink">{look.data.public_ref}</Meta>.
        </p>
      ) : null}
      <p className="max-w-prose">
        Pressing the button destroys the key your email address is kept under. After that nobody,
        including the people who run this site, can read your address or write to you about this
        report. This cannot be undone.
      </p>
      <Card variant="deep" className="gap-2">
        <h2 className="label-face text-sm text-brand-on-deep">What this does not do</h2>
        <p className="max-w-prose">
          Your report is not withdrawn. It stays exactly as it is, sealed, and is published or not
          as before. If you want it taken down, withdraw it from “My reports” first.
        </p>
      </Card>
      {erase.isError ? (
        <Alert tone="serious" title="It was not erased">
          {erase.error.message}
        </Alert>
      ) : null}
      <CheckOption
        id="erase-sure"
        checked={sure}
        onCheckedChange={(on) => {
          setSure(on === true);
        }}
        label="I understand this cannot be undone."
      />
      <div className="flex flex-col items-start gap-2">
        {/* Secondary: a destructive action is never the action colour. */}
        <Button
          type="button"
          variant="secondary"
          disabled={!sure}
          busy={erase.isPending}
          busyLabel="Erasing…"
          aria-describedby={sure ? undefined : 'erase-why'}
          onClick={() => {
            erase.mutate();
          }}
        >
          Erase my details
        </Button>
        {sure ? null : (
          <p id="erase-why" className="text-sm text-ink-alt">
            Tick the statement above first.
          </p>
        )}
      </div>
    </LinkPage>
  );
}

/** A page reached from a link in an email: its heading, and nothing of the rest of the site. */
function LinkPage({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <section className="mx-auto flex w-full max-w-[40rem] flex-col gap-6">
      <div className="flex flex-col gap-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="font-display text-title">{title}</h1>
      </div>
      {children}
    </section>
  );
}
