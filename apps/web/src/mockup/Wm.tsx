/**
 * The mock-up's wordmark: `<a class="wm">Election<b>Log</b><i>.org</i></a>`.
 * The name is the site's own (settings), its two accents are the `<b>` and
 * `<i>` the stylesheet colours; before the settings arrive it is the
 * software's name, as the header's wordmark is.
 */
import { Link } from '@tanstack/react-router';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { BrandRuns } from './Wordmark.tsx';

export function Wm({ to = '/', onClick }: { to?: '/' | '/home'; onClick?: () => void }) {
  const site = useSite().data;
  return (
    <Link
      to={to}
      className="wm"
      aria-label={
        site ? `${plainSiteName(site)}, ${to === '/home' ? 'your dashboard' : 'home'}` : undefined
      }
      onClick={onClick}
    >
      {site ? <BrandRuns parts={site.name_parts} /> : 'ReportLog'}
    </Link>
  );
}
