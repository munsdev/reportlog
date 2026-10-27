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
import { useId, useState } from 'react';
import { Alert } from '../../../components/ui/alert.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Card } from '../../../components/ui/card.tsx';
import { Chip } from '../../../components/ui/chip.tsx';
import { Empty } from '../../../components/ui/empty.tsx';
import { KeyValueList } from '../../../components/ui/key-value-list.tsx';
import { ToastProvider, useToast } from '../../../components/ui/toast.tsx';
import { Ptabs } from '../../../mockup/Ptabs.tsx';
import { Btn } from '../../../mockup/Btn.tsx';
import { Err, Problem } from '../../../mockup/Notice.tsx';
import { Panel } from '../../../mockup/Panel.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { RadioGroup, RadioOption } from '../../../components/ui/radio-group.tsx';
import { call } from '../../../lib/api.ts';
import { AskDialog } from './AskDialog.tsx';
import { LimitsPanel } from './LimitsPanel.tsx';
import { fileSettingsQuery, logbookLimitsQuery } from './queries.ts';
import { PUBLICATION, describeFile } from './words.ts';

/**
 * The pages under /files that are for administrators, as the page's own
 * tabs under the area's: the site's limits, each logbook's, and erasing.
 */
export function FileAdminSections() {
  const { pathname } = useLocation();
  const here = pathname.replace(/\/+$/, '');
  return (
    <Ptabs
      label="File settings"
      tabs={[
        { to: '/files/settings', label: 'The site', current: here === '/files/settings' },
        {
          to: '/files/logbooks',
          label: 'Each logbook',
          current: here.startsWith('/files/logbooks'),
        },
        { to: '/files/erase', label: 'Erasing a file', current: here === '/files/erase' },
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
            <LimitsPanel layers={query.data.limits} mine="site" onSave={put} />
          </>
        ) : null}
      </StaffPage>
    </ToastProvider>
  );
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
      <Alert title="This site cannot take files yet">
        {settings.why_not ??
          'File storage is not set up on the server, so no files are taken whatever is chosen here.'}{' '}
        Whoever runs the server sets this up; nothing on this page can.
      </Alert>
    );
  }
  return (
    <Card heading="Taking files">
      <KeyValueList
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
        <Alert tone="serious" title="That did not change.">
          {save.error.message}
        </Alert>
      ) : null}
      {chosen !== now ? (
        <div>
          <Button
            busy={save.isPending}
            busyLabel="Changing…"
            onClick={() => {
              save.mutate(chosen === 'on');
            }}
          >
            {chosen === 'on' ? 'Turn it on' : 'Turn it off'}
          </Button>
        </div>
      ) : null}
    </Card>
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
      title="Files: each logbook"
      lede="A logbook takes files only if it has a question asking for them. Its limits can be tighter than the site’s, and can be changed after it is launched."
      width="prose"
    >
      <FileAdminSections />
      {query.isPending ? <p role="status">Reading the logbooks…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        query.data.logbooks.length === 0 ? (
          <Empty title="No logbooks yet">
            Each logbook’s own limits are set here once it has been made.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Logbooks">
            {query.data.logbooks.map((lb) => (
              <li key={lb.id}>
                <Link
                  to="/files/logbooks/$id"
                  params={{ id: String(lb.id) }}
                  className="flex min-h-11 flex-wrap items-center gap-3 rounded-card border-(length:--rl-border-main) border-ink-alt bg-surface p-4 shadow-raised hover:bg-paper-alt"
                >
                  <span className="flex-1 font-display text-lg font-bold">{lb.title}</span>
                  <Chip tone="tag">{lb.asks_for_files ? 'Asks for files' : 'No files'}</Chip>
                  {lb.files_frozen_at ? <Chip tone="tag">Uploads frozen</Chip> : null}
                </Link>
              </li>
            ))}
          </ul>
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
      <StaffPage title={lb ? `Files: ${lb.title}` : 'Files: one logbook'} width="prose">
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
  const id = useId();
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
    <StaffPage title="Erasing a file" width="prose">
      <FileAdminSections />
      <Panel kind="deep" title="What erasing does">
        <p>
          Erasing destroys the key the file was locked with, so nobody can ever open it again, this
          site included. Its fingerprint stays in the report, which still checks out. It cannot be
          undone.
        </p>
        <p>Every erasure is recorded on the file’s record, with your name and your reason.</p>
      </Panel>
      <Panel title="Which report is the file on?">
        <p className="muted" id={`${id}-help`}>
          Its reference, as on the report.
        </p>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (!problem) setLooked(ref.trim().toUpperCase());
          }}
        >
          <input
            type="text"
            aria-label="Reference"
            aria-describedby={`${id}-help`}
            value={ref}
            placeholder="RL-XXXX-XX"
            autoComplete="off"
            onChange={(e) => {
              setRef(e.target.value);
            }}
          />
          <Btn sm flat type="submit">
            Show its files
          </Btn>
        </form>
        <Err>{tried ? problem : null}</Err>
      </Panel>
      {query.isFetching ? <p role="status">Finding the report…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data ? <ErasingList data={query.data} /> : null}
    </StaffPage>
  );
}

function ErasingList({ data }: { data: ErasingData }) {
  const qc = useQueryClient();
  if (!data.files.length) return <p>{data.public_ref} has no files.</p>;
  return (
    <>
      {data.files.map((f) => {
        const name = f.original_name ?? `File ${String(f.ordinal)}`;
        return (
          <article className="panel" key={f.id}>
            <h2>{name}</h2>
            <p className="m">
              {describeFile(f)} · {f.erased ? 'Erased' : PUBLICATION[f.publication]}
            </p>
            <p className="m" style={{ wordBreak: 'break-all' }}>
              Fingerprint (SHA-256): {f.sha256}
            </p>
            {f.erased ? (
              <p>This file has been erased.</p>
            ) : (
              <div className="acts">
                <AskDialog
                  trigger={(open) => (
                    <Btn sm flat onClick={open}>
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
          </article>
        );
      })}
    </>
  );
}
