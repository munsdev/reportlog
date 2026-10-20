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
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
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
      <Page title="This link does not match anything" width="prose">
        <p>
          {missing
            ? 'Either the whole link was not copied, or your email address has already been erased.'
            : look.error.message}
        </p>
      </Page>
    );
  }
  if (erase.isSuccess) {
    return (
      <Page title="Your email address is erased" width="prose">
        <Alert tone="confirmed" title="Done">
          The key your address was kept under is destroyed. Nobody can read it again, and nobody can
          reach you about this report. Your report itself is unchanged.
        </Alert>
      </Page>
    );
  }
  if (look.data.state === 'not_yet_filed') {
    return (
      <Page title="Nothing to erase yet" width="prose" lede={`For “${look.data.logbook_title}”.`}>
        <p>
          Your report has not been filed, so this site holds nothing but the message it sent you. If
          you do not want to file it, ignore that email: the link in it stops working on its own.
        </p>
      </Page>
    );
  }
  return (
    <Page
      title="Erase your email address"
      width="prose"
      lede={`For your report ${look.data.public_ref ?? ''} to “${look.data.logbook_title}”.`}
    >
      <p>
        Pressing the button destroys the key your email address is kept under. After that nobody,
        including the people who run this site, can read your address or write to you about this
        report. This cannot be undone.
      </p>
      <p>
        <strong>Your report is not withdrawn.</strong> It stays exactly as it is, sealed, and is
        published or not as before. If you want it taken down, withdraw it from “My reports” first.
      </p>
      {erase.isError ? (
        <Alert tone="serious" title="It was not erased">
          {erase.error.message}
        </Alert>
      ) : null}
      <div className="flex items-start gap-3">
        <Checkbox
          id="erase-sure"
          checked={sure}
          onCheckedChange={(on) => {
            setSure(on === true);
          }}
        />
        <Label htmlFor="erase-sure" className="font-normal">
          I understand this cannot be undone.
        </Label>
      </div>
      <div>
        <Button
          type="button"
          disabled={!sure || erase.isPending}
          onClick={() => {
            erase.mutate();
          }}
        >
          {erase.isPending ? 'Erasing…' : 'Erase my email address'}
        </Button>
      </div>
    </Page>
  );
}
