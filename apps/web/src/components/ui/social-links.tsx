/**
 * The site's accounts elsewhere, as an administrator switched them on
 * (Site → Social media). Two shapes: a row of marks for the footer, where
 * every page has it and room is short, and a list with the platforms named
 * for the front page. Nothing is drawn when no account is on: absent, not
 * an empty row.
 *
 * PLAIN LINKS, SENT WITH NO REFERRER. A platform learns that somebody
 * arrived from somewhere, never from which page: a reporter reading how to
 * file should not have that told to Facebook. `rel="me"` lets a platform
 * that checks it (Mastodon) confirm the account really is this site's.
 */
import type { PublicSocialLink } from '@reportlog/contracts';
import { SOCIAL_RULES } from '@reportlog/contracts';
import { cn } from '@/lib/utils.ts';
import { SocialIcon } from './social-icon.tsx';

const REL = 'me noopener noreferrer';

export function SocialLinks({
  links,
  siteName,
  variant,
  className,
}: {
  links: readonly PublicSocialLink[] | undefined;
  siteName: string;
  variant: 'icons' | 'list';
  className?: string;
}) {
  if (!links?.length) return null;
  if (variant === 'icons') {
    return (
      <ul className={cn('flex flex-wrap justify-center gap-1', className)}>
        {links.map((l) => {
          const label = `${siteName} on ${SOCIAL_RULES[l.id].name}`;
          return (
            <li key={l.id}>
              <a
                href={l.url}
                rel={REL}
                referrerPolicy="no-referrer"
                aria-label={label}
                title={label}
                data-social={l.id}
                className="inline-flex size-11 items-center justify-center rounded-control text-ink-alt hover:text-ink"
              >
                <SocialIcon platform={l.id} />
              </a>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {links.map((l) => (
        <li key={l.id}>
          <a
            href={l.url}
            rel={REL}
            referrerPolicy="no-referrer"
            data-social={l.id}
            className="inline-flex min-h-11 items-center gap-3 underline underline-offset-4"
          >
            <SocialIcon platform={l.id} />
            {SOCIAL_RULES[l.id].name}
          </a>
        </li>
      ))}
    </ul>
  );
}
