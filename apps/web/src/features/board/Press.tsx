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
import { Link } from '@tanstack/react-router';
import { Alert } from '../../components/ui/alert.tsx';
import { NotASample } from '../../components/ui/not-a-sample.tsx';
import { Page } from '../../components/ui/page.tsx';
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
    <Page
      title="Press pack"
      lede="Documents about this archive, for reporters, reviewers and anybody writing about it."
      width="prose"
    >
      <Link to="/board" className="underline">
        Back to the board
      </Link>
      {query.isPending ? <p role="status">Reading the pack…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {d?.state === 'none' ? <p>Nothing has been published here yet.</p> : null}
      {d?.state === 'unreadable' ? (
        <Alert>
          The press pack could not be read. Its list of files is not in the right shape.
        </Alert>
      ) : null}
      {d?.state === 'ready' ? (
        <>
          {d.version || d.built_at ? (
            <p className="text-sm text-ink-alt">
              {d.version ? `Version ${d.version}` : ''}
              {d.version && d.built_at ? ', ' : ''}
              {d.built_at ? `built ${new Date(d.built_at).toLocaleDateString()}` : ''}.
            </p>
          ) : null}
          {d.files.length === 0 ? <p>Nothing has been published here yet.</p> : null}
          <NotASample line={d.not_a_sample} />
          <ul className="flex flex-col gap-4" aria-label="Documents">
            {d.files.map((f) => (
              <li
                key={f.key}
                className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4"
              >
                {f.bytes === null ? (
                  <span className="font-semibold">{f.label} (not built yet)</span>
                ) : (
                  <a
                    className="font-semibold underline"
                    href={PRESS_FILE_PATH.replace(':key', encodeURIComponent(f.key))}
                    download
                  >
                    {f.label}
                  </a>
                )}
                {f.blurb ? <span>{f.blurb}</span> : null}
                <span className="text-sm text-ink-alt">
                  {f.bytes === null
                    ? 'Listed in the pack, but the file is missing.'
                    : size(f.bytes)}
                  {f.version ? ` · its own version, ${f.version}` : ''}
                  {f.note ? ` · ${f.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Page>
  );
}
