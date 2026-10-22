/**
 * "If someone needs help right now" (decision 62): the operator's wording,
 * or what ships, in a deep panel that must not be missed. Always drawn on
 * the front page and every logbook's opening card: the slot cannot be
 * blanked (apps/api/src/site/copy.ts). The opening card takes the words from
 * the logbook's own form call, so a door has them; the front page from the
 * site's wording.
 */
import { Card } from '@/components/ui/card.tsx';

export function HelpNow({ text }: { text: string }) {
  return (
    <Card variant="deep" className="gap-2">
      <h2 className="label-face text-sm text-brand-on-deep">If someone needs help right now</h2>
      <p data-copy="help_now" className="max-w-prose whitespace-pre-wrap">
        {text}
      </p>
    </Card>
  );
}
