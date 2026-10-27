/**
 * THE FOLLOW ALONG BAND (decision D11), as the mock-up draws it
 * (`.follow`): the eyebrow, a heading and a line, and a large button per
 * account with its mark, the platform and the handle. Other pages drop it in
 * by name: `<FollowBand placement="after_filing" />`. Each placement is a
 * switch on Site → Social media, so a page never decides for itself; it
 * draws nothing, not an empty box, when no account is on or its placement is
 * off.
 *
 * NO HANDLE SHIPS IN CODE. Everything on it comes from the accounts an
 * administrator typed in, and the heading and line from the Follow along
 * words (neutral until written). The links are plain links: no referrer,
 * nothing embedded, nothing fetched.
 *
 * `bleed` is kept for the pages that pass it; the band is always full width.
 * `tight` is the mock-up's smaller band for the middle of a page.
 */
import type { SocialPlacement } from '@reportlog/contracts';
import { SOCIAL_RULES } from '@reportlog/contracts';
import { useSite } from '@/components/ui/site.tsx';
import { SocialMark } from '@/mockup/SocialMark.tsx';
import { socialHandle } from './handle.ts';
import { useFollow } from './useFollow.ts';

export function FollowBand({
  placement,
  tight = false,
  title,
  line,
  className,
}: {
  placement: SocialPlacement;
  bleed?: boolean;
  tight?: boolean;
  /** Overrides the Follow along heading, for a page with its own. */
  title?: string;
  line?: string;
  className?: string;
}) {
  const { links, name } = useFollow(placement);
  const copy = useSite().data?.copy;
  if (!links.length) return null;
  return (
    <section
      className={['follow', tight ? 'tight' : '', className ?? ''].filter(Boolean).join(' ')}
      aria-labelledby="follow-h"
      data-follow-band={placement}
    >
      <div className="wrap">
        <div className="follow-txt">
          <span className="eyebrow">Follow {name}</span>
          <h2 id="follow-h">{title ?? copy?.follow_heading ?? 'Follow along'}</h2>
          <p>{line ?? copy?.follow_line ?? ''}</p>
        </div>
        <div className="follow-btns">
          {links.map((l) => {
            const handle = socialHandle(l.id, l.url);
            return (
              <a
                key={l.id}
                className="fbtn"
                href={l.url}
                rel="me noopener noreferrer"
                referrerPolicy="no-referrer"
                data-social={l.id}
              >
                <span className="fic2">
                  <SocialMark platform={l.id} />
                </span>
                <span>
                  <b>{SOCIAL_RULES[l.id].name}</b>
                  {handle ? <small>{handle}</small> : null}
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
