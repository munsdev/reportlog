/**
 * A public report's files, for the board (workstream D puts it on a report's
 * page). "3 attached, 1 published" is said in full, because either number
 * alone hides something: that files were sent, or that some are withheld.
 *
 * Every copy shown is the re-encoded one, from this site's own origin. The
 * digest beside it is the original's, which the report seals; it is shown
 * so a holder of the original can check it, and is not the digest of the
 * copy on screen.
 */
import { FILE_PATHS, getReportFiles } from '@reportlog/contracts';
import type { PublishedFile } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { call } from '@/lib/api.ts';

export function PublishedFiles({ publicRef }: { publicRef: string }) {
  const files = useQuery({
    queryKey: ['report-files', publicRef],
    queryFn: ({ signal }) => call(getReportFiles, { params: { ref: publicRef }, signal }),
    retry: false,
  });
  if (!files.data?.attached) return null;
  const { attached, published } = files.data;
  return (
    <section style={{ display: 'grid', gap: 12 }} aria-label="Files">
      <p className="m">
        {attached === 1 ? '1 file attached' : `${String(attached)} files attached`},{' '}
        {published.length ? `${String(published.length)} published` : 'none published'}.
      </p>
      {published.map((f) => (
        <figure key={f.ordinal} style={{ display: 'grid', gap: 6, margin: 0 }}>
          <Shown file={f} />
          <figcaption>
            {f.alt_text}
            <span className="m mono" style={{ display: 'block', overflowWrap: 'anywhere' }}>
              Original’s SHA-256: {f.sha256}
            </span>
          </figcaption>
        </figure>
      ))}
    </section>
  );
}

function Shown({ file }: { file: PublishedFile }) {
  if (file.media_type.startsWith('video/')) {
    // No captions exist for evidence somebody filmed; nobody has transcribed
    // it. The moderator's description is the figcaption beside it.
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- see above
      <video
        controls
        preload="none"
        style={{ width: '100%', borderRadius: 'var(--rl-radius)' }}
        src={FILE_PATHS.publicFile(file.key)}
        aria-label={file.alt_text}
        {...(file.has_poster ? { poster: FILE_PATHS.publicPoster(file.key) } : {})}
      />
    );
  }
  if (file.media_type.startsWith('audio/')) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- as for video, above
      <audio
        controls
        preload="none"
        src={FILE_PATHS.publicFile(file.key)}
        aria-label={file.alt_text}
      />
    );
  }
  // Photos, and a document's pages (drawn as pictures; the PDF is never shown).
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {Array.from({ length: file.pages }, (_, i) => (
        <img
          key={i}
          src={i === 0 ? FILE_PATHS.publicFile(file.key) : FILE_PATHS.publicPage(file.key, i + 1)}
          alt={file.pages > 1 ? `${file.alt_text} (page ${String(i + 1)})` : file.alt_text}
          loading="lazy"
          style={{ maxWidth: '100%', borderRadius: 'var(--rl-radius)', border: '1.5px solid var(--rl-border)' }}
        />
      ))}
    </div>
  );
}
