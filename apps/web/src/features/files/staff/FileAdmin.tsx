/**
 * The administrator's files screens: whether the site takes files, which
 * kinds and how much; one logbook's own limits; and erasing one file.
 *
 * Nothing here changes any report. Limits are not questions, so they may be
 * changed on a launched logbook; erasing a file destroys its key and leaves
 * its fingerprint in the report, which still checks out.
 */
import {
  eraseFile,
  getReportFilesForErasing,
  listLogbooks,
  setFileSettings,
  setLogbookFileLimits,
} from '@reportlog/contracts';
import type { BodyOf, FileSettings, ResponseOf } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '../../../components/ui/alert.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Field, FieldDescription, FieldError } from '../../../components/ui/field.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Page } from '../../../components/ui/page.tsx';
import { RadioGroup, RadioOption } from '../../../components/ui/radio-group.tsx';
import { call } from '../../../lib/api.ts';
import { AskDialog } from './AskDialog.tsx';
import { LimitsForm } from './LimitsForm.tsx';
import { fileSettingsQuery, logbookLimitsQuery } from './queries.ts';
import { PUBLICATION, describeFile } from './words.ts';

/** The pages under /files that are for administrators, as one row of links. */
export function FileAdminSections() {
  return (
    <nav aria-label="File settings">
      <ul className="flex flex-wrap gap-x-4 gap-y-2 border-b border-line pb-3 text-sm font-semibold">
        {(
          [
            { to: '/files/settings', label: 'The site' },
            { to: '/files/logbooks', label: 'Each logbook' },
            { to: '/files/erase', label: 'Erasing a file' },
          ] as const
        ).map((s) => (
          <li key={s.to}>
            <Link
              to={s.to}
              className="underline-offset-4 hover:underline aria-[current=page]:underline"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function FileSettingsPage() {
  const qc = useQueryClient();
  const query = useQuery(fileSettingsQuery());
  const put = (body: BodyOf<typeof setFileSettings>) =>
    call(setFileSettings, { body }).then((d) => {
      qc.setQueryData(fileSettingsQuery().queryKey, d);
      return d;
    });
  return (
    <Page
      title="Files: the site"
      lede="Whether this site takes files with reports, which kinds, and how large. A logbook can narrow these, never widen them."
      width="prose"
    >
      <FileAdminSections />
      {query.isPending ? <p role="status">Reading the settings…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        <>
          <Switch settings={query.data} put={put} />
          <section className="flex flex-col gap-4" aria-labelledby="site-limits">
            <h2 id="site-limits" className="font-display text-2xl font-bold">
              Kinds and limits
            </h2>
            <LimitsForm layers={query.data.limits} mine="site" onSave={put} />
          </section>
        </>
      ) : null}
    </Page>
  );
}

function Switch({
  settings,
  put,
}: {
  settings: FileSettings;
  put: (body: { enabled: boolean }) => Promise<unknown>;
}) {
  const [on, setOn] = useState(settings.enabled);
  const save = useMutation({ mutationFn: () => put({ enabled: on }) });
  if (!settings.configured) {
    return (
      <Alert title="This site cannot take files yet">
        {settings.why_not ??
          'File storage is not set up on the server, so no files are taken whatever is chosen here.'}{' '}
        Whoever runs the server sets this up; nothing on this page can.
      </Alert>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p>
        <span className="font-semibold">Now:</span>{' '}
        {settings.enabled
          ? 'files are taken, on logbooks with a question asking for them.'
          : 'no files are taken.'}
        {settings.enabled_stored === null
          ? ' (Nobody has chosen here; this is the server’s setting.)'
          : ''}
      </p>
      <RadioGroup
        value={on ? 'on' : 'off'}
        onValueChange={(v) => {
          setOn(v === 'on');
        }}
        aria-label="Does this site take files?"
      >
        <RadioOption
          value="on"
          label="Take files"
          hint="Only on logbooks with a question asking for them."
        />
        <RadioOption
          value="off"
          label="Do not take files"
          hint="Files already sent stay with their reports. Nobody can send more, and no new evidence can be asked for."
        />
      </RadioGroup>
      {save.isError ? <Alert tone="serious">{save.error.message}</Alert> : null}
      {save.isSuccess ? <Alert tone="done">Saved.</Alert> : null}
      <div>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

// ── each logbook ───────────────────────────────────────────────────────

export function LogbookLimitsList() {
  const query = useQuery({
    queryKey: ['files-staff', 'logbooks'],
    queryFn: () => call(listLogbooks),
    refetchOnWindowFocus: false,
  });
  return (
    <Page
      title="Files: each logbook"
      lede="A logbook takes files only if it has a question asking for them. Its limits can be tighter than the site’s, and can be changed after it is launched."
      width="prose"
    >
      <FileAdminSections />
      {query.isPending ? <p role="status">Reading the logbooks…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        query.data.logbooks.length === 0 ? (
          <p>There are no logbooks yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Logbooks">
            {query.data.logbooks.map((lb) => (
              <li key={lb.id}>
                <Link
                  to="/files/logbooks/$id"
                  params={{ id: String(lb.id) }}
                  className="block rounded-card border border-line bg-surface p-4 hover:bg-paper-alt"
                >
                  <span className="font-semibold">{lb.title}</span>{' '}
                  <span className="text-ink-alt">
                    · {lb.asks_for_files ? 'asks for files' : 'asks for no files'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Page>
  );
}

export function LogbookLimitsPage({ id }: { id: number }) {
  const qc = useQueryClient();
  const query = useQuery(logbookLimitsQuery(id));
  const books = useQuery({
    queryKey: ['files-staff', 'logbooks'],
    queryFn: () => call(listLogbooks),
    refetchOnWindowFocus: false,
  });
  const lb = books.data?.logbooks.find((l) => l.id === id);
  return (
    <Page title={lb ? `Files: ${lb.title}` : 'Files: one logbook'} width="prose">
      <FileAdminSections />
      {lb && !lb.asks_for_files ? (
        <Alert>
          This logbook has no question asking for files, so it takes none whatever its limits say.
          Add one in the logbook’s questions.
        </Alert>
      ) : null}
      {query.isPending ? <p role="status">Reading the limits…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        <LimitsForm
          layers={query.data}
          mine="logbook"
          onSave={(body) =>
            call(setLogbookFileLimits, { params: { id }, body }).then((d) => {
              qc.setQueryData(logbookLimitsQuery(id).queryKey, d);
            })
          }
        />
      ) : null}
    </Page>
  );
}

// ── erasing a file ─────────────────────────────────────────────────────

type ErasingData = ResponseOf<typeof getReportFilesForErasing>;

export function EraseFilePage() {
  const [ref, setRef] = useState('');
  const [tried, setTried] = useState(false);
  const [looked, setLooked] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['files-staff', 'erasing', looked],
    queryFn: () => call(getReportFilesForErasing, { params: { ref: looked ?? '' } }),
    enabled: looked !== null,
    refetchOnWindowFocus: false,
  });
  const problem = ref.trim() ? null : 'Type a report’s reference first.';
  return (
    <Page title="Erasing a file" width="prose">
      <FileAdminSections />
      <Card variant="deep" heading="What erasing does">
        <p>
          Erasing destroys the key the file was locked with, so nobody can ever open it again, this
          site included. Its fingerprint stays in the report, which still checks out. It cannot be
          undone.
        </p>
        <p>Every erasure is recorded on the file’s record, with your name and your reason.</p>
      </Card>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!problem) setLooked(ref.trim().toUpperCase());
        }}
      >
        <Field>
          <Label>Which report is the file on?</Label>
          <FieldDescription>Its reference, as on the report.</FieldDescription>
          <Input
            value={ref}
            placeholder="RL-…"
            autoComplete="off"
            onChange={(e) => {
              setRef(e.target.value);
            }}
          />
          <FieldError>{tried ? problem : null}</FieldError>
        </Field>
        <div>
          <Button type="submit" variant="secondary">
            Show its files
          </Button>
        </div>
      </form>
      {query.isFetching ? <p role="status">Finding the report…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? <ErasingList data={query.data} /> : null}
    </Page>
  );
}

function ErasingList({ data }: { data: ErasingData }) {
  const qc = useQueryClient();
  if (!data.files.length) return <p>{data.public_ref} has no files.</p>;
  return (
    <ul className="flex flex-col gap-3" aria-label={`Files on ${data.public_ref}`}>
      {data.files.map((f) => {
        const name = f.original_name ?? `File ${String(f.ordinal)}`;
        return (
          <li key={f.id}>
            <Card>
              <CardHeader>
                <CardTitle>{name}</CardTitle>
                <p className="text-sm text-ink-alt">
                  {describeFile(f)} · {f.erased ? 'Erased' : PUBLICATION[f.publication]}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-sm break-all text-ink-alt">
                  Fingerprint (SHA-256): <span className="font-mono">{f.sha256}</span>
                </p>
                {f.erased ? (
                  <p>This file has been erased.</p>
                ) : (
                  <div>
                    <AskDialog
                      trigger={<Button variant="secondary">Erase this file…</Button>}
                      title={`Erase ${name} for good`}
                      description={`Nobody will ever be able to open it again. If it is published, it is taken down first. The report ${data.public_ref} keeps its fingerprint.`}
                      questions={[
                        {
                          label: 'Why is it being erased?',
                          hint: 'Kept on the file’s record.',
                          multiline: true,
                          min: 10,
                          max: 2000,
                          tooShort: 'Say why in a sentence: it is kept on the file’s record.',
                        },
                      ]}
                      finish="Erase it for good"
                      onFinish={async ([reason]) => {
                        await call(eraseFile, {
                          params: { id: f.id },
                          body: { reason: reason ?? '' },
                        });
                        await qc.invalidateQueries({ queryKey: ['files-staff'] });
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
