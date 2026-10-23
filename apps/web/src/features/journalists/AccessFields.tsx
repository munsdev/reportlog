/**
 * The questions a request for desk access asks, wherever it is asked: the
 * alerts sign-up, the change page behind every alert (owner decision 69)
 * and the emailed request link. One set of fields, so the owner reads the
 * same request whichever way it came.
 */
import type { AccessRequestBody } from '@reportlog/contracts';
import { useId } from 'react';
import { Label } from '@/components/ui/label.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { TextField } from '../identity/ui.tsx';

export interface AccessDraft {
  outlet: string;
  role: string;
  about: string;
  cardNumber: string;
  cardIssuer: string;
}

export const EMPTY_ACCESS: AccessDraft = {
  outlet: '',
  role: '',
  about: '',
  cardNumber: '',
  cardIssuer: '',
};

/** The request as the API takes it; a press card left blank is not sent. */
export const accessBody = (d: AccessDraft): AccessRequestBody => ({
  outlet: d.outlet,
  role: d.role,
  about: d.about,
  ...(d.cardNumber.trim() ? { press_card_number: d.cardNumber.trim() } : {}),
  ...(d.cardIssuer.trim() ? { press_card_issuer: d.cardIssuer.trim() } : {}),
});

export function AccessFields({
  value,
  onChange,
}: {
  value: AccessDraft;
  onChange: (next: AccessDraft) => void;
}) {
  const id = useId();
  const set = (key: keyof AccessDraft) => (e: { target: { value: string } }) => {
    onChange({ ...value, [key]: e.target.value });
  };
  return (
    <>
      <TextField
        label="Your outlet"
        autoComplete="organization"
        required
        maxLength={160}
        value={value.outlet}
        onChange={set('outlet')}
      />
      <TextField
        label="Your role there"
        hint="Reporter, editor, producer."
        required
        maxLength={120}
        value={value.role}
        onChange={set('role')}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-about`}>Who are you?</Label>
        <p id={`${id}-about-hint`} className="text-sm text-muted">
          Enough for the owner to tell who you are and what you cover. Links to your published work
          or a profile help most, if you have them.
        </p>
        <Textarea
          id={`${id}-about`}
          aria-describedby={`${id}-about-hint`}
          required
          maxLength={4000}
          rows={5}
          value={value.about}
          onChange={set('about')}
        />
      </div>
      <TextField
        label="Press card number (optional)"
        maxLength={80}
        value={value.cardNumber}
        onChange={set('cardNumber')}
      />
      <TextField
        label="Who issued the press card (optional)"
        maxLength={160}
        value={value.cardIssuer}
        onChange={set('cardIssuer')}
      />
    </>
  );
}
