/**
 * `/verify` with no reference: the bare form the old app had (public.md §06),
 * in the mock-up's band (verify.html). It asks the server for nothing; Enter
 * goes to `/verify/:ref`. Caddy's catch-all already hands this address to the app.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Band, MockPage } from '../mockup/Band.tsx';
import { RefForm } from '../mockup/RefForm.tsx';
import { useBodyClass } from '../mockup/useBodyClass.ts';

export const Route = createFileRoute('/verify/')({
  component: VerifyForm,
});

function VerifyForm() {
  useBodyClass('light');
  return (
    <MockPage>
      <Band
        eyebrow="Check a report"
        title="Has it changed?"
        tabTitle="Check a report"
        lead="Enter a report reference. This page fetches the report’s sealed record and recomputes its fingerprint in your browser, then compares it with the chain."
      />
      <div className="wrap" style={{ paddingTop: 28, display: 'grid', gap: 26, maxWidth: 720 }}>
        <RefForm />
      </div>
    </MockPage>
  );
}
