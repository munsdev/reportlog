/**
 * What the filing form says once Send has worked (mock-up file-sent.html and
 * file-check-email.html). Two answers, because there are two outcomes:
 *
 *   FiledReceipt  sealed on arrival (E1): nothing to confirm and nothing to
 *                 come back to. The reference is shown here and only here
 *                 (owner, 2026-10-24), beside the line that says nobody has
 *                 accepted it yet, so it is never read as approval. Quiet,
 *                 not teal: teal says a moderator confirmed something.
 *   SentReceipt   held until the emailed link is followed: nothing is filed.
 *
 * Both replace the form, and focus moves to the heading. The Follow along
 * band (placement `after_filing`) sits under a filed report only.
 */
import type { ReactNode } from 'react';
import { Steps, Wrap } from '@/components/ui/band.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Alert } from '@/components/ui/alert.tsx';
import { Eyebrow } from '@/components/ui/type.tsx';
import { FollowBand } from '@/features/follow/FollowBand.tsx';
import { useGateMode } from '@/features/identity/gateMode.ts';
import { CopyButton } from '@/features/site-pages/CopyButton.tsx';
import { useFocusOnMount } from './CardFrame.tsx';
import { TipOffer } from './tipOffer.tsx';

export function FiledReceipt({ title, reference }: { title: string; reference: string }) {
  return (
    <Receipt
      eyebrow="Sent"
      heading={`Your report to “${title}” is on the record`}
      follow
      after={
        <>
          <Steps
            items={[
              { title: 'A moderator reads it next.', body: 'Nothing is public before that.' },
              {
                title: 'If it meets the standard and you allowed it, it is published.',
                body: 'Look it up with your reference on the board.',
              },
              {
                title: 'It stays on the record.',
                body: 'Nobody can quietly change it or take it down.',
              },
            ]}
          />
          <TipOffer />
        </>
      }
    >
      <div className="grid content-start gap-2.5 rounded-card border-(length:--rl-border-main) border-ink bg-surface p-[18px] shadow-raised">
        <span className="font-mono text-xs tracking-[0.1em] text-muted uppercase">
          Your reference
        </span>
        <p
          className="font-display text-[clamp(2rem,8vw,3.5rem)] leading-none tracking-[0.02em] break-all"
          aria-label={`Reference ${reference.split('').join(' ')}`}
        >
          {reference}
        </p>
        <p className="text-[0.95rem] text-ink-alt">
          Save this. It is how you find your report on the board once it is published. Nothing ties
          this report to you, so it cannot be changed now. If something was wrong, file a new one.
        </p>
        <CopyButton text={reference} what="the reference" />
      </div>
    </Receipt>
  );
}

export function SentReceipt({ email, title }: { email: string; title: string }) {
  return (
    <Receipt eyebrow="One more step" heading="Check your email to finish">
      <p className="max-w-[62ch] text-lede text-ink-alt">
        We have sent a link to <strong className="break-all text-ink">{email}</strong>.{' '}
        <b className="text-ink">Your report is filed when you press it.</b> Nothing is filed in “
        {title}” until then, and the link works for 24 hours.
      </p>
      <Alert tone="note">If nothing arrives in a few minutes, look in your spam folder.</Alert>
    </Receipt>
  );
}

/** The receipt replaces the form; focus moves to its heading. */
function Receipt({
  eyebrow,
  heading,
  children,
  after,
  follow = false,
}: {
  eyebrow: string;
  heading: string;
  children: ReactNode;
  after?: ReactNode;
  follow?: boolean;
}) {
  const onDoor = useGateMode() === 'door';
  const focused = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div data-bleed className="flex flex-col">
      <Wrap className="pt-8 pb-12">
        <div className="flex max-w-[40rem] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 ref={focused} tabIndex={-1} className="font-display text-title outline-none">
              {heading}
            </h1>
          </div>
          {children}
          {after}
          {/* Behind the password on a door, so not offered there. */}
          {onDoor ? null : (
            <p className="flex flex-wrap gap-x-2">
              <Button asChild variant="quiet">
                <a href="/">Back to the front page</a>
              </Button>
              <Button asChild variant="quiet">
                <a href="/board">See the board</a>
              </Button>
            </p>
          )}
        </div>
      </Wrap>
      {follow ? <FollowBand placement="after_filing" bleed /> : null}
    </div>
  );
}
