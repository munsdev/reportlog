/**
 * The questions a request for desk access asks, wherever it is asked: the
 * alerts sign-up, the change page behind every alert (owner decision 69)
 * and the emailed request link. One set of fields, so the owner reads the
 * same request whichever way it came.
 */
import type { AccessRequestBody } from '@reportlog/contracts';
import { useId } from 'react';
import { Field } from '../../mockup/Qcard.tsx';

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
      <Field label="Your outlet" htmlFor={`${id}-outlet`}>
        <input
          className="input"
          id={`${id}-outlet`}
          autoComplete="organization"
          required
          maxLength={160}
          value={value.outlet}
          onChange={set('outlet')}
        />
      </Field>
      <Field label="Your role there" htmlFor={`${id}-role`} help="Reporter, editor, producer.">
        <input
          className="input"
          id={`${id}-role`}
          required
          maxLength={120}
          value={value.role}
          onChange={set('role')}
        />
      </Field>
      <Field
        label="Who are you?"
        htmlFor={`${id}-about`}
        help="Enough for the owner to tell who you are and what you cover. Links to your published work or a profile help most, if you have them."
      >
        <textarea
          className="textarea"
          id={`${id}-about`}
          required
          maxLength={4000}
          rows={5}
          value={value.about}
          onChange={set('about')}
        />
      </Field>
      <Field label="Press card number (optional)" htmlFor={`${id}-card`}>
        <input
          className="input"
          id={`${id}-card`}
          maxLength={80}
          value={value.cardNumber}
          onChange={set('cardNumber')}
        />
      </Field>
      <Field label="Who issued the press card (optional)" htmlFor={`${id}-issuer`}>
        <input
          className="input"
          id={`${id}-issuer`}
          maxLength={160}
          value={value.cardIssuer}
          onChange={set('cardIssuer')}
        />
      </Field>
    </>
  );
}
