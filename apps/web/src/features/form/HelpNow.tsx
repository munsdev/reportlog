/**
 * The call to action box (decisions 62 and 78): a heading, the operator's
 * words and, when both a label and a link are set, a button. It is the
 * emergency notice by default ("If someone needs help right now"). Drawn on
 * the front page and on a cover that follows the site; with no words it draws
 * nothing, which is how an operator switches it off. The opening card takes
 * the words from the logbook's own form call, so a door has them; the front
 * page from the site's wording.
 */
import { Button } from '@/components/ui/button.tsx';

export const DEFAULT_CTA_HEADING = 'If someone needs help right now';

export interface CtaProps {
  text: string;
  heading?: string | undefined;
  buttonLabel?: string | undefined;
  buttonUrl?: string | undefined;
}

export function HelpNow({
  text,
  heading,
  buttonLabel,
  buttonUrl,
  mini = false,
}: CtaProps & {
  /** The mock-up's small notice on a cover: a rule at the left, no panel. */
  mini?: boolean;
}) {
  if (!text.trim()) return null;
  const label = buttonLabel?.trim();
  const url = buttonUrl?.trim();
  // A path on this site stays in the tab; anything with a scheme leaves it.
  const external = url ? /^[a-z][a-z0-9+.-]*:/i.test(url) : false;
  if (mini) {
    return (
      <div className="border-l-[5px] border-ink py-1 pl-3 text-[0.95rem] text-ink-alt">
        <h2 className="font-display font-bold text-ink">
          {heading?.trim() ? heading.trim() : DEFAULT_CTA_HEADING}
        </h2>
        <p data-copy="help_now" className="max-w-prose whitespace-pre-wrap">
          {text}
        </p>
        {label && url ? (
          <Button asChild variant="quiet" className="-ml-2">
            <a href={url} {...(external ? { rel: 'noopener' } : {})}>
              {label}
            </a>
          </Button>
        ) : null}
      </div>
    );
  }
  // The mock-up's box, on its own ground: dark ink border and offset, the
  // wording "Before you start" over the heading.
  return (
    <div className="section">
      <div
        className="cta urgent scope-dark"
        style={{
          borderColor: 'var(--p-ink)',
          boxShadow: 'var(--rl-shadow-offset) var(--rl-shadow-offset) 0 var(--p-ink)',
        }}
      >
        <span className="mark">Before you start</span>
        <h3>{heading?.trim() ? heading.trim() : DEFAULT_CTA_HEADING}</h3>
        <p data-copy="help_now">{text}</p>
        {label && url ? (
          <a className="btn sm flat" href={url} {...(external ? { rel: 'noopener' } : {})}>
            {label}
          </a>
        ) : null}
      </div>
    </div>
  );
}
