/**
 * `/verify` with no reference: the bare form the old app had (public.md §06),
 * in the mock-up's band. It asks the server for nothing; Enter goes to
 * `/verify/:ref`. Caddy's catch-all already hands this address to the app.
 */
import { createFileRoute } from '@tanstack/react-router';
import { BandPage } from '../components/ui/band.tsx';
import { CheckAReport } from '../features/board/CheckAReport.tsx';

export const Route = createFileRoute('/verify/')({
  component: VerifyForm,
});

function VerifyForm() {
  return (
    <BandPage
      title="Check a report"
      heading="Has it changed?"
      eyebrow="Check a report"
      lede="Enter a report reference. This page fetches the report’s sealed record and recomputes its fingerprint in your browser, then compares it with the chain."
    >
      <div className="max-w-[640px]">
        <CheckAReport
          inline
          button="Check"
          help="Looks like RL-XXXX-XX. It is on the report page and in your email."
        />
      </div>
    </BandPage>
  );
}
