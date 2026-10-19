/**
 * A report's files, and what a moderator decides about each one, through
 * workstream F's API (files/publication.ts holds the rules).
 *
 * CONSENT IS THE CEILING, MODERATION IS THE FLOOR. A file can be published
 * only while the reporter permits it, and is shown only while the report's
 * text is public: a report's words can be public without its files, never
 * its files without its words.
 *
 * WHAT IS SHOWN HERE IS THE RE-ENCODED COPY, with camera details and location
 * removed. The original still carries them, so opening it asks for a reason,
 * which is recorded and which the reporter is shown.
 */
import { FILE_PATHS, getThreadFiles, setFilePublication } from '@reportlog/contracts';
import type { ThreadFile } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { call } from '../../lib/api.ts';

const threadFilesQuery = (threadId: string) => ({
  queryKey: ['moderation', 'files', threadId],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    call(getThreadFiles, { params: { threadId }, signal }),
});

const STATE: Record<ThreadFile['publication'], string> = {
  withheld: 'Not published',
  published: 'Published (shown while the report is public)',
  refused: 'Refused',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function FilesPanel({ threadId, isPublic }: { threadId: string; isPublic: boolean }) {
  const query = useQuery(threadFilesQuery(threadId));
  if (query.isPending) return null;
  if (query.isError) return <Alert tone="serious">{query.error.message}</Alert>;
  const { files, files_permitted: permitted, may_publish: mayPublish } = query.data;
  if (!files.length) return null;
  return (
    <Section title="Files">
      <p>
        {files.length === 1 ? 'One file' : `${String(files.length)} files`} came with this version.{' '}
        {!mayPublish
          ? 'Its reporter did not permit publishing the report, so its files stay private too.'
          : permitted
            ? 'Its reporter permits publishing them.'
            : 'Its reporter has not permitted publishing them; only they can.'}{' '}
        {isPublic ? '' : 'Nothing here is shown publicly until the report’s text is approved.'}
      </p>
      <ul className="flex flex-col gap-4">
        {files.map((f) => (
          <li key={f.id}>
            <OneFile f={f} canPublish={permitted && mayPublish} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function OneFile({ f, canPublish }: { f: ThreadFile; canPublish: boolean }) {
  const qc = useQueryClient();
  const [alt, setAlt] = useState(f.alt_text ?? '');
  const [reason, setReason] = useState('');
  const [originalWhy, setOriginalWhy] = useState('');
  const decide = useMutation({
    mutationFn: (publication: ThreadFile['publication']) =>
      call(setFilePublication, {
        params: { id: f.id },
        body: { publication, reason, ...(publication === 'published' ? { alt_text: alt } : {}) },
      }),
    onSuccess: async () => {
      setReason('');
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  const label = `File ${String(f.ordinal)}`;
  return (
    <article aria-label={label} className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-sm">
        <span className="font-semibold">{label}</span> · {f.media_type} ·{' '}
        {Math.max(1, Math.round(f.byte_size / 1024))} KB · {STATE[f.publication]}
        {f.erased ? ' · erased' : ''}
      </p>
      {f.erased ? null : (
        <>
          <p className="flex flex-wrap gap-x-4 text-sm">
            <a className="underline" href={FILE_PATHS.moderatorView(f.id, 'rendition')}>
              Open the cleaned copy
            </a>
          </p>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const url = `${FILE_PATHS.moderatorView(f.id, 'original')}?reason=${encodeURIComponent(originalWhy)}`;
              window.open(url, '_blank', 'noopener');
            }}
          >
            <Field className="flex-1">
              <Label>Why you need the original</Label>
              <Input
                value={originalWhy}
                onChange={(e) => {
                  setOriginalWhy(e.target.value);
                }}
              />
              <FieldDescription>
                The original still carries where and on what it was taken. The reporter is shown
                this reason.
              </FieldDescription>
            </Field>
            <Button type="submit" variant="secondary" disabled={originalWhy.trim().length < 3}>
              Open the original
            </Button>
          </form>
          <Field>
            <Label>Describe it (for people who cannot see it)</Label>
            <Input
              value={alt}
              onChange={(e) => {
                setAlt(e.target.value);
              }}
            />
          </Field>
          <Field>
            <Label>Why, for the record</Label>
            <Input
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </Field>
          {decide.error ? <Alert tone="serious">{decide.error.message}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={decide.isPending || !canPublish || f.publication === 'published'}
              onClick={() => {
                decide.mutate('published');
              }}
            >
              Publish this file
            </Button>
            <Button
              variant="secondary"
              disabled={decide.isPending || f.publication === 'withheld'}
              onClick={() => {
                decide.mutate('withheld');
              }}
            >
              Withhold it
            </Button>
            <Button
              variant="secondary"
              disabled={decide.isPending || f.publication === 'refused'}
              onClick={() => {
                decide.mutate('refused');
              }}
            >
              Refuse it
            </Button>
          </div>
        </>
      )}
    </article>
  );
}
