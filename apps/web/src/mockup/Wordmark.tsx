/**
 * The wide one-line wordmark (`.wm`): the site's name from its settings, the
 * first accent run in <b> and the second in <i>, as the mock-up draws
 * "Election<b>Log</b><i>.org</i>". While the settings load, and on a door
 * (which may not ask for them), it is the software's own name.
 */
import { Link } from '@tanstack/react-router';
import { Fragment } from 'react';
import type { BrandPart } from '@reportlog/contracts';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';

export function BrandRuns({ parts }: { parts: readonly BrandPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.mark === 'a' ? (
          <b key={i}>{p.text}</b>
        ) : p.mark === 'b' ? (
          <i key={i}>{p.text}</i>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

export function Wordmark({ onClick }: { onClick?: () => void }) {
  const site = useSite().data;
  return (
    <Link
      to="/"
      className="wm"
      aria-label={`${plainSiteName(site)}, home`}
      {...(onClick ? { onClick } : {})}
    >
      {site ? <BrandRuns parts={site.name_parts} /> : 'ReportLog'}
    </Link>
  );
}
