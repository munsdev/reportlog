/**
 * The press pack: the deployment's own documents, built ahead of time and
 * downloaded as files. ReportLog ships none, so until an operator builds a
 * pack this page says so plainly rather than looking broken.
 *
 * A file the pack lists but which is missing is shown as missing, not
 * hidden: it means the pack was not rebuilt, and that is worth seeing.
 */
import { PRESS_FILE_PATH, getPressPack } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Alert } from '../../components/ui/alert.tsx';
import { NotASample } from '../../components/ui/not-a-sample.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Meta } from '../../components/ui/type.tsx';
import { BoardFrame } from './BoardFrame.tsx';
import { call } from '../../lib/api.ts';

export const pressQuery = queryOptions({
  queryKey: ['board', 'press'],
  queryFn: ({ signal }) => call(getPressPack, { signal }),
});

function size(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PressPage() {
  const query = useQuery(pressQuery);
  const d = query.data;
  return (
    <BoardFrame
      title="Press pack"
      lede="Documents about this archive, for reporters, reviewers and anybody writing about it."
      width="prose"
    >
      {query.isPending ? <p role="status">Reading the pack…</p> : null}
      {query.isError ? (
        <Alert tone="serious" title="The press pack could not be loaded">
          {query.error.message}
        </Alert>
      ) : null}
      {d?.state === 'none' ? <NothingYet /> : null}
      {d?.state === 'unreadable' ? (
        <Alert>
          The press pack could not be read. Its list of files is not in the right shape.
        </Alert>
      ) : null}
      {d?.state === 'ready' ? (
        <>
          {d.files.length === 0 ? <NothingYet /> : null}
          <NotASample line={d.not_a_sample} />
          {/* One row per document: its title, its kind and size in mono, and
              Download. A file the pack lists but which is missing says so in
              its row rather than being hidden. */}
          <ul
            className="flex flex-col divide-y divide-line rounded-card border border-ink-alt bg-surface"
            aria-label="Documents"
          >
            {d.files.map((f) => (
              <li
                key={f.key}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-semibold">{f.label}</span>
                  {f.blurb ? <span className="text-ink-alt">{f.blurb}</span> : null}
                  <Meta>
                    {f.bytes === null
                      ? 'This file is missing.'
                      : `${kindOf(f.key)} · ${size(f.bytes)}`}
                    {f.version ? ` · its own version, ${f.version}` : ''}
                    {f.note ? ` · ${f.note}` : ''}
                  </Meta>
                </div>
                {f.bytes === null ? null : (
                  <Button asChild variant="secondary" className="shrink-0">
                    <a
                      href={PRESS_FILE_PATH.replace(':key', encodeURIComponent(f.key))}
                      download
                      aria-label={`Download ${f.label}`}
                    >
                      Download
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </BoardFrame>
  );
}

function NothingYet() {
  return (
    <Empty title="Nothing published here yet">
      Nothing has been published here yet. Documents appear here when the people who run this site
      build a press pack.
    </Empty>
  );
}

/** The kind of file, from its name, in words: "PDF", "CSV". */
function kindOf(key: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1];
  return ext ? ext.toUpperCase() : 'File';
}
