/**
 * `/verify` with no reference: the bare form the old app had (public.md §06).
 * It asks the server for nothing; Enter goes to `/verify/:ref`. Caddy's
 * catch-all already hands this address to the app.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Card } from '../components/ui/card.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { Eyebrow, Lede } from '../components/ui/type.tsx';
import { CheckAReport } from '../features/board/CheckAReport.tsx';

export const Route = createFileRoute('/verify/')({
  component: VerifyForm,
});

function VerifyForm() {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `Check a report · ${site}`;
  }, [site]);
  return (
    <section className="flex max-w-prose flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>{site}</Eyebrow>
        <h1 className="font-display text-title">Check a report</h1>
        <Lede>Enter a report reference.</Lede>
      </div>
      <Card variant="quiet">
        <CheckAReport help={null} />
      </Card>
    </section>
  );
}
