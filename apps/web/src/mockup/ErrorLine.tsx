import type { ReactNode } from 'react';
import { ApiRequestError } from '../lib/api.ts';

/** A sentence from the server, or a plain one if it sent none. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Something went wrong. Try again.';
}

/** The mock-up's `.error` line for a failed call. Nothing when there is no error. */
export function ErrorLine({ error }: { error: unknown }): ReactNode {
  if (!error) return null;
  return (
    <p role="alert" className="error">
      {messageOf(error)}
    </p>
  );
}
