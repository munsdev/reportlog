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
import { Steps } from '@/components/ui/band.tsx';
import { Eyebrow, Meta } from '@/components/ui/type.tsx';
import { useGateMode } from '@/features/identity/gateMode.ts';
import { useFocusOnMount } from './CardFrame.tsx';
import { HelpNow, type CtaProps } from './HelpNow.tsx';

/** The trimmed text, or the fallback when there is none. */
function orElse(text: string | undefined, fallback: string): string {
  const t = text?.trim();
  return t === undefined || t === '' ? fallback : t;
}

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

/** A fact about what the form does with what is sent (mock-up .kv-list on a list's cover). */
export interface CoverFact {
  term: string;
  detail: string;
}

export function Cover({
  kind,
  title,
  blurb,
  cover,
  site,
  facts,
  onStart,
}: {
  kind: CoverKind;
  title: string;
  blurb: string | null;
  cover?: CoverWords | null | undefined;
  /** The site's call to action, where the page could ask for it. */
  site: CtaProps | null;
  /** What the list publishes, asks and keeps, said before the first question. */
  facts?: readonly CoverFact[] | undefined;
  /** A list's Start lives in its card bar, so it passes nothing. */
  onStart?: (() => void) | undefined;
}) {
  const onDoor = useGateMode() === 'door';
  const siteName = plainSiteName(useSite().data);
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const eyebrow = orElse(cover?.eyebrow, kind === 'logbook' ? 'File a report' : '');
  const intro = cover?.intro?.trim();
  const cta = resolveCta(kind, cover, site);
  // The mock-up's cover: one bordered box, a top with the title (the cover
  // header background draws here once the look system's host lands), a body.
  return (
    <div className="max-w-[720px] overflow-hidden rounded-card border-(length:--rl-border-main) border-ink bg-surface">
      <div className="grid gap-2.5 border-b-(length:--rl-border-main) border-ink px-5 pt-[22px] pb-5">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 ref={heading} tabIndex={-1} className="font-display text-title outline-none">
          {title}
        </h1>
      </div>
      <div className="grid gap-[18px] px-5 pt-[18px] pb-[22px]">
        {blurb ? <p className="whitespace-pre-wrap text-ink-alt">{blurb}</p> : null}
        {intro ? <p className="whitespace-pre-wrap text-ink-alt">{intro}</p> : null}
        {cta ? <HelpNow {...cta} mini /> : null}
        {facts?.length ? (
          <dl className="grid border-t border-line">
            {facts.map((f) => (
              <div
                key={f.term}
                className="grid gap-1 border-b border-line py-3.5 min-[640px]:grid-cols-[220px_1fr] min-[640px]:gap-4"
              >
                <dt className="label-face text-xs text-muted">{f.term}</dt>
                <dd className="m-0 font-medium">{f.detail}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {kind === 'logbook' ? (
          <Steps
            items={[
              {
                title: 'You answer and send it.',
                body: 'You get a reference number once it is filed.',
              },
              { title: 'A moderator reads it.', body: 'Nothing is public before that.' },
              {
                title: 'If it is approved and you allowed it, it is published.',
                body: 'Anyone can read it, and it stays on the record.',
              },
            ]}
          />
        ) : (
          <Meta>{SMALL_LINE[kind]}</Meta>
        )}
        {onStart ? (
          <div className="flex flex-col items-stretch gap-3 sm:items-start">
            <Button size="lg" block className="sm:w-auto" onClick={onStart}>
              {orElse(cover?.button_label, 'Start')}
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
    </div>
  );
}
