/**
 * The site's name as it will be drawn: on the header's deep bar, and on the
 * page's own ground (the password screen, the heading of an email). Shared
 * by the Name screen and the setup wizard's name step, so both show the same
 * thing. Pictures of the header, not the header: the Menu in them is a
 * shape, hidden from screen readers, and nothing in them can be pressed.
 */
import { parseBrand } from '@reportlog/contracts';
import { BrandName } from '@/components/ui/site.tsx';

export function NamePreview({ name, page = true }: { name: string; page?: boolean }) {
  const parts = parseBrand(name);
  return (
    <>
      <div className="name-prev" role="img" aria-label={`How the header will show it: ${name}`}>
        <span className="wm" style={{ fontSize: '1.4rem' }}>
          {parts.map((p, i) =>
            p.mark === 'a' ? (
              <b key={i}>{p.text}</b>
            ) : p.mark === 'b' ? (
              <i key={i}>{p.text}</i>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </span>
      </div>
      {page ? (
        <p className="muted">
          On the page, the password screen and in emails: <BrandName parts={parts} />
        </p>
      ) : null}
    </>
  );
}
