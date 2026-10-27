/**
 * The cards the free-text kinds add around the questions: sharing (G5), the
 * address, and the optional "manage" card (D2, D8, D20). Their words are the
 * approved mock-up's.
 *
 * ADDRESS, ALWAYS HELD (D20): an address given on any report holds the report
 * until the emailed link is followed, so every card that asks says so before
 * anybody types.
 */
import { Choice, Choices } from '@/mockup/Choice.tsx';
import { Field, TextInput } from '@/mockup/Field.tsx';
import { useId } from 'react';
import { CardFrame } from './CardFrame.tsx';

/** "2027-01-31" as "January 31, 2027", in the reporter's reading, not their clock. */
export function longDate(day: string | undefined): string | null {
  if (!day) return null;
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/** The long text on the review card, cut so a page of words is not a page of review. */
export function shortened(value: string | null, kind: string): string | null {
  if (value === null || kind !== 'private_text') return value;
  const one = value.replace(/\s+/g, ' ');
  return one.length > 60 ? `${one.slice(0, 57).trimEnd()}…` : one;
}

export function ShareCard({
  eyebrow,
  value,
  onChange,
  problem,
}: {
  eyebrow: string;
  value: '' | 'yes' | 'no';
  onChange: (v: 'yes' | 'no') => void;
  problem: string | null;
}) {
  const id = useId();
  // NOTHING IS SELECTED until the reporter chooses: both tiles are unchecked
  // while `value` is '' and Next says to choose.
  return (
    <CardFrame
      eyebrow={eyebrow}
      step="Asked because you wrote something"
      heading="Can vetted journalists read what you wrote?"
      focusKey="share"
      headingId={`${id}-q`}
      help={
        <p className="muted">
          Only journalists the site owner has checked, after a moderator has read it. They never see
          your email. You can change this later.
        </p>
      }
      error={problem}
    >
      <Choices role="radiogroup" aria-labelledby={`${id}-q`}>
        <Choice
          name={`${id}-share`}
          checked={value === 'yes'}
          onChange={() => {
            onChange('yes');
          }}
        >
          Yes, after a moderator checks it
        </Choice>
        <Choice
          name={`${id}-share`}
          checked={value === 'no'}
          onChange={() => {
            onChange('no');
          }}
        >
          No, keep it for the moderators only
        </Choice>
      </Choices>
    </CardFrame>
  );
}

function AddressFacts({ deleteOn, first }: { deleteOn: string | undefined; first: string }) {
  const day = longDate(deleteOn);
  return (
    <ul className="muted" style={{ fontSize: '.9rem', display: 'grid', gap: 4, paddingLeft: 18 }}>
      <li>{first}</li>
      {day ? <li>Deleted on {day}, or sooner if you erase it.</li> : null}
    </ul>
  );
}

export function ContactCard({
  eyebrow,
  wrote,
  deleteOn,
  value,
  onChange,
  problem,
}: {
  eyebrow: string;
  /** Words or a link were given: the address is needed, and the card says why. */
  wrote: boolean;
  deleteOn: string | undefined;
  value: string;
  onChange: (v: string) => void;
  problem: string | null;
}) {
  const id = useId();
  const input = (
    <TextInput
      id={id}
      type="email"
      inputMode="email"
      autoComplete="email"
      value={value}
      aria-describedby={problem ? 'contact-error' : undefined}
      aria-invalid={problem ? true : undefined}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  );
  if (!wrote) {
    return (
      <CardFrame
        eyebrow={eyebrow}
        heading="Where can we reach you?"
        focusKey="contact"
        help={
          <p className="muted">
            We send a link there to confirm the report is really from you. Nothing is filed until
            you open it. Your address is never published and is not part of the report.
          </p>
        }
        error={problem}
        errorId="contact-error"
      >
        <Field label="Your email address" htmlFor={id}>
          {input}
        </Field>
      </CardFrame>
    );
  }
  return (
    <CardFrame
      eyebrow={eyebrow}
      step="Needed because you wrote something"
      heading="Your email address"
      focusKey="contact"
      help={
        <p className="muted">
          We email you one link. <b>Your report is filed when you press it.</b> The address also
          lets you correct, withdraw or erase what you wrote from My reports.
        </p>
      }
      error={problem}
      errorId="contact-error"
    >
      <Field label="Email" htmlFor={id}>
        {input}
      </Field>
      <AddressFacts
        deleteOn={deleteOn}
        first="Never published, never shown to journalists. A moderator can open it only with a written reason, and you are shown that reason."
      />
      <p className="m">If you go back and remove what you wrote, the email becomes optional.</p>
    </CardFrame>
  );
}

export function ManageCard({
  eyebrow,
  deleteOn,
  value,
  onChange,
  problem,
}: {
  eyebrow: string;
  deleteOn: string | undefined;
  value: string;
  onChange: (v: string) => void;
  problem: string | null;
}) {
  const id = useId();
  return (
    <CardFrame
      eyebrow={eyebrow}
      step="Optional"
      heading="Want to be able to correct or withdraw it later?"
      focusKey="manage"
      help={
        <p className="muted">
          Leave an email address and you can correct or withdraw the report from My reports. If you
          do, we email you a link and <b>the report is filed when you press it</b>. Skip this and it
          is filed right away, and can’t be changed after.
        </p>
      }
      error={problem}
      errorId="manage-error"
    >
      <Field
        label={
          <>
            Your email address <span className="muted">(optional)</span>
          </>
        }
        htmlFor={id}
      >
        <TextInput
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value}
          aria-describedby={problem ? 'manage-error' : undefined}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      </Field>
      <AddressFacts
        deleteOn={deleteOn}
        first="Never published. A moderator can open it only with a written reason, and you are shown that reason."
      />
    </CardFrame>
  );
}
