/**
 * The two pieces the identity screens share: a sentence from the server, and
 * a failure drawn in the mock-up's `.error` line (status, never a button).
 */
import { ApiRequestError } from '../../lib/api.ts';

/** A sentence from the server, or a plain one if it sent none. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Something went wrong. Try again.';
}

export function ErrorText({ error, id }: { error: unknown; id?: string }) {
  if (!error) return null;
  return (
    <p {...(id ? { id } : {})} role="alert" className="error">
      {messageOf(error)}
    </p>
  );
}
