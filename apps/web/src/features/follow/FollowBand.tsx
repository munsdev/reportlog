/**
 * THE FOLLOW ALONG BAND (decision D11): a large button per account, each with
 * its mark, the platform and the handle. Other pages drop it in by name:
 * `<FollowBand placement="after_filing" />`. Each placement is a switch on
 * Site → Social media, so a page never decides for itself; it draws nothing,
 * not an empty box, when no account is on or its placement is off.
 *
 * NO HANDLE SHIPS IN CODE. Everything on it comes from the accounts an
 * administrator typed in, and the wording is neutral. The links are the same
 * plain links as everywhere else (social-links.tsx): no referrer, nothing
 * embedded, nothing fetched.
 *
 * `bleed` is the front page's, full width under the header; without it the
 * band is a card in the page's own column.
 */
import type { SocialPlacement } from '@reportlog/contracts';
import { SOCIAL_RULES } from '@reportlog/contracts';
import { SocialIcon } from '@/components/ui/social-icon.tsx';
import { cn } from '@/lib/utils.ts';
import { socialHandle } from './handle.ts';
import { useFollow } from './useFollow.ts';

export function FollowBand({
  placement,
  bleed = false,
  className,
}: {
  placement: SocialPlacement;
  bleed?: boolean;
  className?: string;
}) {
  const { links, name } = useFollow(placement);
  if (!links.length) return null;
  const heading = `follow-${placement}`;
  return (
    <section
      aria-labelledby={heading}
      data-follow-band={placement}
      className={cn(
        'bg-deep text-on-deep print:hidden',
        bleed ? 'border-b border-line-on-deep' : 'rounded-card border border-line-on-deep',
        className,
      )}
    >
      <div
        className={cn(
          'grid gap-5 py-6 lg:items-center',
          bleed
            ? 'mx-auto max-w-[76rem] px-[max(1rem,env(safe-area-inset-left))] md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'
            : 'px-5',
        )}
      >
        <div className="min-w-0">
          <p className="label-face text-xs text-on-deep-muted">Follow {name}</p>
          <h2 id={heading} className="font-display text-2xl leading-tight">
            Follow along
          </h2>
        </div>
        <ul
          className={cn(
            'grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2',
            bleed && 'lg:grid-cols-4',
          )}
        >
          {links.map((l) => {
            const handle = socialHandle(l.id, l.url);
            return (
              <li key={l.id} className="min-w-0">
                <a
                  href={l.url}
                  rel="me noopener noreferrer"
                  referrerPolicy="no-referrer"
                  data-social={l.id}
                  className="flex min-h-14 items-center gap-3 rounded-card bg-surface px-3.5 py-2.5 text-ink hover:bg-paper-alt focus-visible:outline-on-deep"
                >
                  <SocialIcon platform={l.id} className="size-7 shrink-0" />
                  <span className="min-w-0">
                    <b className="block font-display leading-tight">{SOCIAL_RULES[l.id].name}</b>
                    {handle ? (
                      <small className="block truncate text-sm text-ink-alt">{handle}</small>
                    ) : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
