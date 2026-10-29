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
import { Link, useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Empty } from '@/mockup/Empty.tsx';
import { Dl } from '@/mockup/Dl.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { PTabs } from '@/mockup/PTabs.tsx';
import { rowCols, RowItem, Rows } from '@/mockup/Rows.tsx';
import { St } from '@/mockup/St.tsx';
import { ToastProvider, useToast } from '../../../components/ui/toast.tsx';
import { Field, FieldDescription, FieldError, Input, Label } from '@/mockup/Field.tsx';
import { RadioGroup, RadioOption } from '@/mockup/Choice.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../../lib/api.ts';
import { AskDialog } from './AskDialog.tsx';
import { FilesTabs } from './FilesTabs.tsx';
import { LimitsPanel } from './LimitsPanel.tsx';
import { fileSettingsQuery, logbookLimitsQuery } from './queries.ts';
import { PUBLICATION, describeFile } from './words.ts';

/**
 * File limits' own tabs: the site's limits and each logbook's. Erasing a
 * file is a tab of Files waiting (FilesTabs.tsx).
 */
export function FileAdminSections() {
  const { pathname } = useLocation();
  const here = pathname.replace(/\/+$/, '');
  return (
    <PTabs
      label="Sections"
      tabs={[
        { to: '/files/settings', label: 'The site', current: here === '/files/settings' },
        {
          to: '/files/logbooks',
          label: 'Each logbook',
          current: here.startsWith('/files/logbooks'),
        },
      ]}
    />
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
    <ToastProvider>
      <StaffPage
        title="File limits"
        lede="Whether reports can carry files, and how big. A logbook can narrow these, never widen them."
        tabs={<FileAdminSections />}
      >
        {query.isPending ? <p role="status">Reading the settings…</p> : null}
        {query.isError ? <Note tone="serious">{query.error.message}</Note> : null}
        {query.data ? (
          <>
            <Switch settings={query.data} put={put} />
            <LimitsPanel layers={query.data.limits} mine="site" onSave={put} />
          </>
        ) : null}
      </StaffPage>
    </ToastProvider>
  );
}

/**
 * The Taking files switch on its own, for Switches
 * (routes/(staff)/settings/switches.tsx). Needs a ToastProvider around it.
 */
export function TakingFilesPanel() {
  const qc = useQueryClient();
  const query = useQuery(fileSettingsQuery());
  const put = (body: BodyOf<typeof setFileSettings>) =>
    call(setFileSettings, { body }).then((d) => {
      qc.setQueryData(fileSettingsQuery().queryKey, d);
      return d;
    });
  if (query.isPending)
    return (
      <Panel title="Taking files">
        <p role="status">Reading the settings…</p>
      </Panel>
    );
  if (query.isError) return <Note tone="serious">{query.error.message}</Note>;
  return <Switch settings={query.data} put={put} />;
}

/**
 * Whether the site takes files: a switch that applies at once (§02), two
 * choice cards and one button that does what the chosen card says, then a
 * toast. Choosing a card sends nothing.
 */
function Switch({
  settings,
  put,
}: {
  settings: FileSettings;
  put: (body: { enabled: boolean }) => Promise<unknown>;
}) {
  const toast = useToast();
  const now = settings.enabled ? 'on' : 'off';
  const [choice, setChoice] = useState<'on' | 'off' | null>(null);
  const chosen = choice ?? now;
  const save = useMutation({
    mutationFn: (on: boolean) => put({ enabled: on }),
    onSuccess: (_d, on) => {
      setChoice(null);
      toast.show(on ? 'This site now takes files.' : 'This site no longer takes files.');
    },
  });
  if (!settings.configured) {
    return (
      <Note title="This site cannot take files yet">
        {settings.why_not ??
          'File storage is not set up on the server, so no files are taken whatever is chosen here.'}{' '}
        Whoever runs the server sets this up; nothing on this page can.
      </Note>
    );
  }
  return (
    <Panel title="Taking files">
      <Dl
        items={[
          {
            key: 'Takes files',
            value: settings.enabled ? 'Yes, on logbooks with a question asking for them' : 'No',
          },
          {
            key: 'Set by',
            value:
              settings.enabled_stored === null
                ? 'Nobody has chosen here; this is the server’s setting'
                : 'This page',
          },
        ]}
      />
      <RadioGroup
        value={chosen}
        onValueChange={(v) => {
          save.reset();
          setChoice(v === now ? null : v === 'on' ? 'on' : 'off');
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
      {save.isError ? (
        <Note tone="serious" title="That did not change.">
          {save.error.message}
        </Note>
      ) : null}
      {chosen !== now ? (
        <div className="acts">
          <Btn
            look="ink"
            sm
            flat
            busy={save.isPending}
            busyLabel="Changing…"
            onClick={() => {
              save.mutate(chosen === 'on');
            }}
          >
            {chosen === 'on' ? 'Turn it on' : 'Turn it off'}
          </Btn>
        </div>
      ) : null}
    </Panel>
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
    <StaffPage
      title="File limits: each logbook"
      lede="A logbook takes files only if it has a question asking for them. Its limits can be tighter than the site’s, and can be changed after it is launched."
      tabs={<FileAdminSections />}
    >
      {query.isPending ? <p role="status">Reading the logbooks…</p> : null}
      {query.isError ? <Note tone="serious">{query.error.message}</Note> : null}
      {query.data ? (
        query.data.logbooks.length === 0 ? (
          <Empty title="No logbooks yet">
            Each logbook’s own limits are set here once it has been made.
          </Empty>
        ) : (
          <Rows label="Logbooks">
            {query.data.logbooks.map((lb) => (
              <RowItem key={lb.id}>
                <Link
                  to="/files/logbooks/$id"
                  params={{ id: String(lb.id) }}
                  className="row"
                  style={rowCols('1fr auto')}
                >
                  <span className="t">{lb.title}</span>
                  <span className="chips">
                    <St tone="off">{lb.asks_for_files ? 'Asks for files' : 'No files'}</St>
                    {lb.files_frozen_at ? <St tone="off">Uploads frozen</St> : null}
                  </span>
                </Link>
              </RowItem>
            ))}
          </Rows>
        )
      ) : null}
    </StaffPage>
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
    <ToastProvider>
      <StaffPage
        title={lb ? `File limits: ${lb.title}` : 'File limits: one logbook'}
        tabs={<FileAdminSections />}
      >
        {lb && !lb.asks_for_files ? (
          <Note>
            This logbook has no question asking for files, so it takes none whatever its limits say.
            Add one in the logbook’s questions.
          </Note>
        ) : null}
        {query.isPending ? <p role="status">Reading the limits…</p> : null}
        {query.isError ? <Note tone="serious">{query.error.message}</Note> : null}
        {query.data ? (
          <LimitsPanel
            layers={query.data}
            mine="logbook"
            onSave={(body) =>
              call(setLogbookFileLimits, { params: { id }, body }).then((d) => {
                qc.setQueryData(logbookLimitsQuery(id).queryKey, d);
              })
            }
          />
        ) : null}
      </StaffPage>
    </ToastProvider>
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
    <StaffPage title="Files waiting" tabs={<FilesTabs />}>
      <Panel kind="deep" title="What erasing does">
        <p>
          Erasing destroys the key the file was locked with, so nobody can ever open it again, this
          site included. Its fingerprint stays in the report, which still checks out. It cannot be
          undone.
        </p>
        <p>Every erasure is recorded on the file’s record, with your name and your reason.</p>
      </Panel>
      <form
        className="panel"
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
        <div className="acts">
          <Btn sm flat type="submit">
            Show its files
          </Btn>
        </div>
      </form>
      {query.isFetching ? <p role="status">Finding the report…</p> : null}
      {query.isError ? <Note tone="serious">{query.error.message}</Note> : null}
      {query.data ? <ErasingList data={query.data} /> : null}
    </StaffPage>
  );
}

function ErasingList({ data }: { data: ErasingData }) {
  const qc = useQueryClient();
  if (!data.files.length) return <p>{data.public_ref} has no files.</p>;
  return (
    <div
      aria-label={`Files on ${data.public_ref}`}
      className="form-stack"
      style={{ maxWidth: 'none' }}
    >
      {data.files.map((f) => {
        const name = f.original_name ?? `File ${String(f.ordinal)}`;
        return (
          <Panel
            key={f.id}
            title={name}
            sub={`${describeFile(f)} · ${f.erased ? 'Erased' : PUBLICATION[f.publication]}`}
          >
            <p className="m">
              Fingerprint (SHA-256): <span className="mono">{f.sha256}</span>
            </p>
            {f.erased ? (
              <p>This file has been erased.</p>
            ) : (
              <div className="acts">
                <AskDialog
                  trigger={(open) => (
                    <Btn look="bad" sm flat onClick={open}>
                      Erase this file…
                    </Btn>
                  )}
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
          </Panel>
        );
      })}
    </div>
  );
}
