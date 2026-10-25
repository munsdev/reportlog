/**
 * The first card of a logbook or a list (decision 78): one component for
 * both, so they cannot drift apart. Eyebrow, title, blurb, the operator's
 * introduction, a call to action box (the site's, none, or its own), one
 * small line about what happens, and Start. Every part of `cover` is
 * optional and an absent part means the default. NEVER SEALED: this is
 * presentation, read from beside the form and not from it.
 */
import type { Cover as CoverWords } from '@reportlog/contracts';
import { Button } from '@/components/ui/button.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow, Lede, Meta } from '@/components/ui/type.tsx';
import { useGateMode } from '@/features/identity/gateMode.ts';
import { useFocusOnMount } from './CardFrame.tsx';
import { HelpNow, type CtaProps } from './HelpNow.tsx';

export type CoverKind = 'logbook' | 'list';

const SMALL_LINE: Record<CoverKind, string> = {
  logbook: 'A moderator reads it before anything is public.',
  list: 'Nothing you send here is published. A moderator reads it.',
};

/** Which box the cover draws: its own, the site's, or none. */
export function resolveCta(
  kind: CoverKind,
  cover: CoverWords | null | undefined,
  site: CtaProps | null,
): CtaProps | null {
  const mode = cover?.cta?.mode ?? (kind === 'logbook' ? 'site' : 'hide');
  if (mode === 'hide') return null;
  if (mode === 'site') return site;
  return {
    text: cover?.cta?.body ?? '',
    heading: cover?.cta?.heading,
    buttonLabel: cover?.cta?.button_label,
    buttonUrl: cover?.cta?.button_url,
  };
}

export function Cover({
  kind,
  title,
  blurb,
  cover,
  site,
  onStart,
}: {
  kind: CoverKind;
  title: string;
  blurb: string | null;
  cover?: CoverWords | null | undefined;
  /** The site's call to action, where the page could ask for it. */
  site: CtaProps | null;
  /** A list's Start lives in its card bar, so it passes nothing. */
  onStart?: (() => void) | undefined;
}) {
  const onDoor = useGateMode() === 'door';
  const siteName = plainSiteName(useSite().data);
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const eyebrow = cover?.eyebrow?.trim() || (kind === 'logbook' ? 'File a report' : '');
  const intro = cover?.intro?.trim();
  const cta = resolveCta(kind, cover, site);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 ref={heading} tabIndex={-1} className="font-display text-title outline-none">
          {title}
        </h1>
        {blurb ? <Lede className="whitespace-pre-wrap">{blurb}</Lede> : null}
      </div>
      {intro ? <p className="max-w-prose whitespace-pre-wrap">{intro}</p> : null}
      {cta ? <HelpNow {...cta} /> : null}
      <Meta>{SMALL_LINE[kind]}</Meta>
      {onStart ? (
        <div className="flex flex-col items-stretch gap-3 sm:items-start">
          <Button size="lg" block className="sm:w-auto" onClick={onStart}>
            {cover?.button_label?.trim() || 'Start'}
          </Button>
          {/* Behind the password on a door, so not offered there. */}
          {onDoor ? null : (
            <Button asChild variant="quiet" className="self-center sm:self-start">
              <a href="/how">How to use {siteName}</a>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
