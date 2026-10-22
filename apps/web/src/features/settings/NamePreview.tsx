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
    <div className="flex flex-col gap-4">
      <figure className="m-0 flex flex-col gap-2">
        <figcaption className="text-sm font-semibold">How the header will show it</figcaption>
        <div className="flex items-center justify-between gap-4 rounded-card border-b-[6px] border-brand-on-deep bg-deep px-4 py-3 text-on-deep">
          <p className="font-display text-xl font-bold">
            <BrandName parts={parts} onDeep />
          </p>
          <span
            aria-hidden="true"
            className="label-face rounded-control border-2 border-on-deep px-3 py-2 text-xs"
          >
            Menu
          </span>
        </div>
      </figure>
      {page ? (
        <figure className="m-0 flex flex-col gap-2">
          <figcaption className="text-sm font-semibold">
            On the page, the password screen and in emails
          </figcaption>
          <p className="rounded-card border border-line bg-paper px-4 py-3 font-display text-xl font-bold">
            <BrandName parts={parts} />
          </p>
        </figure>
      ) : null}
    </div>
  );
}
