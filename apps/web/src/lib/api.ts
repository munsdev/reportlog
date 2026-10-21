/**
 * Calling the API through a contract from @reportlog/contracts.
 *
 * The path, the query and the response type all come from the contract, and
 * the response is validated against its schema here too: a server that
 * answered with something else is an error the page can show, not a shape
 * the page silently mis-renders.
 */
import { ApiError } from '@reportlog/contracts';
import type { RouteContract } from '@reportlog/contracts';
import type { z } from 'zod';

export class ApiRequestError extends Error {
  override name = 'ApiRequestError';
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface CallInput<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType> {
  params?: z.input<P>;
  query?: z.input<Q>;
  body?: z.input<B>;
  signal?: AbortSignal;
}

/** A path or query value as text. Anything else is a bug at the call site. */
function asText(v: unknown, what: string): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new Error(`${what} must be a string, number or boolean`);
}

/** `/api/reports/:ref/verify` + `{ ref: 'RL-1' }` → `/api/reports/RL-1/verify`. */
export function pathFor(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/:([A-Za-z_]+)/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null) throw new Error(`pathFor: missing :${name}`);
    return encodeURIComponent(asText(value, `:${name}`));
  });
}

/**
 * Who asks for the second factor again when the server says a step-up is
 * needed (plan E, E3): the step-up dialog (features/identity/StepUp.tsx)
 * sets this. It resolves true once the person has proved it, and false if
 * they closed the dialog instead.
 */
let stepUpHandler: (() => Promise<boolean>) | null = null;

export function setStepUpHandler(handler: (() => Promise<boolean>) | null): void {
  stepUpHandler = handler;
}

/**
 * A step-up asked for and given is followed by the same call once more, so
 * no screen needs to know which of its actions ask for one. Once only: a
 * second refusal is shown like any other.
 */
export async function call<
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType,
>(
  contract: RouteContract<P, Q, B, R>,
  input: CallInput<P, Q, B> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<z.infer<R>> {
  try {
    return await callOnce(contract, input, fetchImpl);
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      error.code === 'step_up_required' &&
      stepUpHandler &&
      (await stepUpHandler())
    ) {
      return callOnce(contract, input, fetchImpl);
    }
    throw error;
  }
}

async function callOnce<
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType,
>(
  contract: RouteContract<P, Q, B, R>,
  input: CallInput<P, Q, B>,
  fetchImpl: typeof fetch,
): Promise<z.infer<R>> {
  let url = pathFor(contract.path, input.params as Record<string, unknown> | undefined);
  if (input.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(input.query)) {
      if (v !== undefined && v !== null) qs.set(k, asText(v, k));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const res = await fetchImpl(url, {
    method: contract.method,
    headers: input.body === undefined ? {} : { 'content-type': 'application/json' },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    ...(input.signal ? { signal: input.signal } : {}),
    credentials: 'same-origin',
  });
  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err = ApiError.safeParse(json);
    throw err.success
      ? new ApiRequestError(res.status, err.data.error.code, err.data.error.message)
      : new ApiRequestError(res.status, 'unknown', `The server answered ${String(res.status)}.`);
  }
  const parsed = contract.response.safeParse(json);
  if (!parsed.success) {
    throw new ApiRequestError(
      res.status,
      'bad_response',
      'The server answered in a shape this page does not understand.',
    );
  }
  return parsed.data;
}
