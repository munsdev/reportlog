/**
 * The press pack: the deployment's own documents, built ahead of time and
 * downloaded as files. ReportLog ships none, so until an operator builds a
 * pack this page says so plainly rather than looking broken.
 *
 * A file the pack lists but which is missing is shown as missing, not
 * hidden: it means the pack was not rebuilt, and that is worth seeing.
 */
import { PRESS_FILE_PATH } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { NotASample } from '../../components/ui/not-a-sample.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { BoardFrame } from './BoardFrame.tsx';

import { pressQuery } from './queries.ts';

export { pressQuery };

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
    >
      {query.isPending ? <p role="status">Reading the pack…</p> : null}
      {query.isError ? (
        <Note warn>
          <span role="alert">
            <b>The press pack could not be loaded.</b> {query.error.message}
          </span>
        </Note>
      ) : null}
      {d?.state === 'none' ? <NothingYet /> : null}
      {d?.state === 'unreadable' ? (
        <Note>
          <span>
            The press pack could not be read. Its list of files is not in the right shape.
          </span>
        </Note>
      ) : null}
      {d?.state === 'ready' ? (
        <>
          {d.files.length === 0 ? <NothingYet /> : null}
          <NotASample line={d.not_a_sample} />
          {/* One row per document: its title, its kind and size, and Download.
              A file the pack lists but which is missing says so in its row
              rather than being hidden. */}
          {d.files.length ? (
            <Tbl
              cols={['Document', '']}
              widths="1fr auto"
              rows={d.files.map((f) => ({
                key: f.key,
                cells: [
                  <>
                    <b>{f.label}</b>
                    {f.blurb ? (
                      <>
                        <br />
                        {f.blurb}
                      </>
                    ) : null}
                    <br />
                    <span className="m">
                      {f.bytes === null
                        ? 'This file is missing.'
                        : `${kindOf(f.key)} · ${size(f.bytes)}`}
                      {f.version ? ` · its own version, ${f.version}` : ''}
                      {f.note ? ` · ${f.note}` : ''}
                    </span>
                  </>,
                  f.bytes === null ? null : (
                    <a
                      className="btn sm flat"
                      href={PRESS_FILE_PATH.replace(':key', encodeURIComponent(f.key))}
                      download
                      aria-label={`Download ${f.label}`}
                    >
                      Download
                    </a>
                  ),
                ],
              }))}
            />
          ) : null}
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
