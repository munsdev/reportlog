/**
 * The shape every mail transport shares.
 *
 * ONE RECIPIENT PER MESSAGE. Everything this site sends (a sign-in code, a
 * confirmation link, a digest) is addressed to one person, and a message
 * with several recipients is how one person's address ends up in another
 * person's inbox.
 *
 * A send never throws for a reason outside the program: a provider that is
 * down or refuses the message is an ordinary result the caller must decide
 * about (retry, tell the person, log). A bug, such as an empty subject, does
 * throw.
 */
export type EmailTransport = 'off' | 'capture' | 'scaleway';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Always required: some people read mail as plain text, and some filters score its absence. */
  text: string;
  html?: string;
}

export type SendResult =
  | { sent: true; transport: EmailTransport; id?: string }
  | {
      sent: false;
      transport: EmailTransport;
      /**
       * not-configured: this deployment cannot send mail at all (transport off).
       * invalid: the address is not one a provider would accept.
       * rejected: the provider refused this message; sending it again will not help.
       * unreachable: the provider could not be reached or failed; it may work later.
       */
      reason: 'not-configured' | 'invalid' | 'rejected' | 'unreachable';
      /** A sentence for the log. Never contains the recipient's address. */
      detail: string;
    };

export interface EmailSender {
  readonly transport: EmailTransport;
  send(message: EmailMessage): Promise<SendResult>;
}

/** Deliberately loose: the provider is the authority, this only stops obvious junk. */
const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export function isSendableAddress(address: string): boolean {
  return address.length <= 254 && ADDRESS.test(address);
}

/** Programming errors, which throw. Anything a person typed is checked by `isSendableAddress`. */
export function assertWellFormed(message: EmailMessage): void {
  if (!message.subject.trim()) throw new Error('An email needs a subject.');
  if (/[\r\n]/.test(message.subject)) throw new Error('An email subject is one line.');
  if (!message.text.trim()) throw new Error('An email needs a plain-text body.');
}
