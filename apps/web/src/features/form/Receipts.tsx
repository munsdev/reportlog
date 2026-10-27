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
import { FollowBand } from '@/features/follow/FollowBand.tsx';
import { useGateMode } from '@/features/identity/gateMode.ts';
import { Btn, BtnLink } from '@/mockup/Btn.tsx';
import { CopyBtn } from '@/mockup/CopyBtn.tsx';
import { Note } from '@/mockup/Note.tsx';
import { useBodyClass } from '@/mockup/useBodyClass.ts';
import { useFocusOnMount } from './CardFrame.tsx';
import { NoticeColumn } from './FormNotice.tsx';
import { TipOffer } from './tipOffer.tsx';

export function FiledReceipt({ reference }: { title: string; reference: string }) {
  useBodyClass('light', 'form');
  const onDoor = useGateMode() === 'door';
  const focused = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div data-bleed>
      <div className="wrap" style={{ paddingTop: 30 }}>
        <div style={{ display: 'grid', gap: 22, maxWidth: 640 }}>
          <span className="eyebrow">Sent</span>
          <h1 ref={focused} tabIndex={-1} className="h-page outline-none" id="h1">
            It’s on the record
          </h1>
          <div className="card">
            <span className="tag">Your reference</span>
            <p className="ref" aria-label={`Reference ${reference.split('').join(' ')}`}>
              {reference}
            </p>
            <p>
              Save this. It is how you find your report on the board once it is published. Nothing
              ties this report to you, so it cannot be changed now. If something was wrong, file a
              new one.
            </p>
            <CopyBtn text={reference} label="Copy the reference">
              Copy reference
            </CopyBtn>
          </div>
          <ol className="steps">
            <li>
              <span>
                <b>A moderator reads it next.</b>Nothing is public before that.
              </span>
            </li>
            <li>
              <span>
                <b>If it meets the standard and you allowed it, it is published.</b>Look it up with
                your reference on the board.
              </span>
            </li>
            <li>
              <span>
                <b>It stays on the record.</b>Nobody can quietly change it or take it down.
              </span>
            </li>
          </ol>
          <div className="sec-head" style={{ marginTop: 10 }}>
            <span className="num" aria-hidden="true">
              +
            </span>
            <h2>While you’re here</h2>
          </div>
          <div className="cards two">
            <TipOffer />
          </div>
          {/* Behind the password on a door, so not offered there. */}
          {onDoor ? null : (
            <BtnLink look="ghost" href="/" style={{ justifySelf: 'start' }}>
              Back to the front page
            </BtnLink>
          )}
        </div>
      </div>
      <FollowBand placement="after_filing" bleed />
    </div>
  );
}

export function SentReceipt({
  email,
  title,
  onChangeAddress,
}: {
  email: string;
  title: string;
  /** Go back to the address card (the receipt cannot be edited, the card can). */
  onChangeAddress?: () => void;
}) {
  const focused = useFocusOnMount<HTMLHeadingElement>();
  return (
    <NoticeColumn>
      <span className="eyebrow">One more step</span>
      <h1 ref={focused} tabIndex={-1} className="h-page outline-none" id="h1">
        Check your email to finish
      </h1>
      <p className="lead">
        We have sent a link to <b className="break-all">{email}</b>.{' '}
        <b>Your report is filed when you press it.</b> Nothing is filed in “{title}” until then, and
        the waiting copy is deleted if the link is never used.
      </p>
      <Note>
        If nothing arrives in a few minutes, look in your spam folder
        {onChangeAddress ? (
          <>
            {' '}
            or{' '}
            <a
              href="#change-address"
              onClick={(e) => {
                e.preventDefault();
                onChangeAddress();
              }}
            >
              change the address
            </a>
          </>
        ) : null}
        . One address can file up to five reports a day.
      </Note>
      <TipOffer />
    </NoticeColumn>
  );
}

/** "This address can't file more today" (file-limit): nothing was filed, the answers are kept. */
export function LimitPage({ onBack }: { onBack: () => void }) {
  const focused = useFocusOnMount<HTMLHeadingElement>();
  return (
    <NoticeColumn>
      <span className="eyebrow">Not sent</span>
      <h1 ref={focused} tabIndex={-1} className="h-page outline-none" id="h1">
        This address can’t file more today
      </h1>
      <p className="lead">
        Nothing was filed. Try again tomorrow. Your answers are kept on this page until you leave
        it.
      </p>
      <Btn style={{ justifySelf: 'start' }} onClick={onBack}>
        Back to your answers
      </Btn>
    </NoticeColumn>
  );
}
