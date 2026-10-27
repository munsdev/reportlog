/**
 * The cards the free-text kinds add around the questions: sharing (G5), the
 * address, and the optional "manage" card (D2, D8, D20). Their words are the
 * approved mock-up's.
 *
 * ADDRESS, ALWAYS HELD (D20): an address given on any report holds the report
 * until the emailed link is followed, so every card that asks says so before
 * anybody types.
 */
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
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
  return (
    <CardFrame
      eyebrow={eyebrow}
      step="Asked because you wrote something"
      heading="Can vetted journalists read what you wrote?"
      focusKey="share"
      headingId={`${id}-q`}
      help={
        <p className="max-w-prose text-ink-alt">
          Only journalists the site owner has checked, after a moderator has read it. They never see
          your email. You can change this later.
        </p>
      }
      error={problem}
    >
      <RadioGroup
        value={value}
        onValueChange={(v) => {
          onChange(v === 'yes' ? 'yes' : 'no');
        }}
        aria-labelledby={`${id}-q`}
      >
        <RadioOption value="yes" label="Yes, after a moderator checks it" />
        <RadioOption value="no" label="No, keep it for the moderators only" />
      </RadioGroup>
    </CardFrame>
  );
}

function AddressFacts({ deleteOn, first }: { deleteOn: string | undefined; first: string }) {
  const day = longDate(deleteOn);
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-alt">
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
  const input = (
    <Input
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
        error={problem}
        errorId="contact-error"
      >
        <Field>
          <Label>Your email address</Label>
          <FieldDescription>
            We send a link there to confirm the report is really from you. Nothing is filed until
            you open it. Your address is never published and is not part of the report.
          </FieldDescription>
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
        <p className="max-w-prose text-ink-alt">
          We email you one link. <b>Your report is filed when you press it.</b> The address also
          lets you correct, withdraw or erase what you wrote from My reports.
        </p>
      }
      error={problem}
      errorId="contact-error"
    >
      <Field>
        <Label>Email</Label>
        {input}
      </Field>
      <AddressFacts
        deleteOn={deleteOn}
        first="Never published, never shown to journalists. A moderator can open it only with a written reason, and you are shown that reason."
      />
      <p className="max-w-prose text-sm text-ink-alt">
        If you go back and remove what you wrote, the email becomes optional.
      </p>
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
  return (
    <CardFrame
      eyebrow={eyebrow}
      step="Optional"
      heading="Want to be able to correct or withdraw it later?"
      focusKey="manage"
      help={
        <p className="max-w-prose text-ink-alt">
          Leave an email address and you can correct or withdraw the report from My reports. If you
          do, we email you a link and <b>the report is filed when you press it</b>. Skip this and it
          is filed right away, and can’t be changed after.
        </p>
      }
      error={problem}
      errorId="manage-error"
    >
      <Field>
        <Label>
          Your email address <span className="font-normal text-ink-alt">(optional)</span>
        </Label>
        <Input
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
