/**
 * The first card of a logbook or a list (decision 78): one component for
 * both, so they cannot drift apart. Eyebrow, title, blurb, the operator's
 * introduction, a call to action box (the site's, none, or its own), one
 * small line about what happens, and Start. Every part of `cover` is
 * optional and an absent part means the default. NEVER SEALED: this is
 * presentation, read from beside the form and not from it.
 */
import type { Cover as CoverWords } from '@reportlog/contracts';
import { Btn } from '@/mockup/Btn.tsx';
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
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const eyebrow = orElse(cover?.eyebrow, kind === 'logbook' ? 'File a report' : '');
  const intro = cover?.intro?.trim();
  const cta = resolveCta(kind, cover, site);
  // The mock-up's cover (file-cover.html): a top with the title, where the
  // cover header background draws (data-slot="cover"), and a body.
  return (
    <div style={{ paddingTop: 26 }}>
      <div className="cover">
        <div className="cover-top motif-host">
          <div className="ov" data-slot="cover" />
          <div className="in">
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            <h1 ref={heading} tabIndex={-1} className="h-page outline-none">
              {title}
            </h1>
          </div>
        </div>
        <div className="body">
          {blurb ? <p className="whitespace-pre-wrap">{blurb}</p> : null}
          {intro ? <p className="whitespace-pre-wrap">{intro}</p> : null}
          {cta ? <HelpNow {...cta} mini /> : null}
          {facts?.length ? (
            <dl className="kv-list">
              {facts.map((f) => (
                <div key={f.term}>
                  <dt>{f.term}</dt>
                  <dd>{f.detail}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {kind === 'logbook' ? (
            <ol className="steps">
              <li>
                <span>
                  <b>You answer and send it.</b>You get a reference number once it is filed.
                </span>
              </li>
              <li>
                <span>
                  <b>A moderator reads it.</b>Nothing is public before that.
                </span>
              </li>
              <li>
                <span>
                  <b>If it is approved and you allowed it, it is published.</b>Anyone can read it,
                  and it stays on the record.
                </span>
              </li>
            </ol>
          ) : (
            <p>{SMALL_LINE[kind]}</p>
          )}
          {onStart ? (
            <Btn look="go" lg onClick={onStart}>
              {orElse(cover?.button_label, 'Start')}
            </Btn>
          ) : null}
        </div>
      </div>
    </div>
  );
}
