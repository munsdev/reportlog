/**
 * The site's two-tone name in the header, linking home.
 *
 * In the label face, uppercase, at 16px (15px on a phone, 13px below 360px).
 * It is cut short with an ellipsis before it ever pushes the Menu button off
 * the bar; the page's own heading says it in full. On a door, and while the
 * site's settings load, it is the software's name: a door asks the server
 * for nothing it does not need, and the name is not one of those things.
 */
import { Link } from '@tanstack/react-router';
import { BrandName, useSite } from '@/components/ui/site.tsx';

export function Wordmark() {
  const site = useSite().data;
  return (
    <Link
      to="/"
      className="inline-flex min-h-11 min-w-0 items-center font-label text-[15px] font-bold tracking-[0.08em] uppercase max-[359px]:text-[13px] md:text-base focus-visible:outline-on-deep"
    >
      <span className="truncate">
        {site ? <BrandName parts={site.name_parts} onDeep /> : 'ReportLog'}
      </span>
    </Link>
  );
}
