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
import { Card } from '@/components/ui/card.tsx';
import { BtnLink } from '@/mockup/Btn.tsx';

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
    // The mock-up's small notice (site.css .mini): a rule at the left, the
    // heading in bold, the words, and a button only when one is set.
    return (
      <div className="mini">
        <b>{heading?.trim() ? heading.trim() : DEFAULT_CTA_HEADING}</b>
        <span data-copy="help_now" className="whitespace-pre-wrap">
          {text}
        </span>
        {label && url ? (
          <BtnLink sm flat href={url} {...(external ? { rel: 'noopener' } : {})}>
            {label}
          </BtnLink>
        ) : null}
      </div>
    );
  }
  return (
    <Card variant="deep" className="gap-2">
      <h2 className="label-face text-sm text-brand-on-deep">
        {heading?.trim() ? heading.trim() : DEFAULT_CTA_HEADING}
      </h2>
      <p data-copy="help_now" className="max-w-prose whitespace-pre-wrap">
        {text}
      </p>
      {label && url ? (
        <div>
          <Button asChild variant="quiet">
            <a href={url} {...(external ? { rel: 'noopener' } : {})}>
              {label}
            </a>
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
