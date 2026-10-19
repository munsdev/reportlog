/**
 * Small pieces the identity routes share.
 */
import type { Me } from '@reportlog/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { HttpError } from '../http/errors.ts';
import { grantsAccess } from './guards.ts';
import { looksLikeEmail, normalizeEmail } from './secrets.ts';
import type { SignedIn } from './sessions.ts';

/** The request body, already parsed and validated against the contract by Fastify. */
export function bodyOf<B extends z.ZodType>(
  _contract: { body?: B },
  request: FastifyRequest,
): z.output<B> {
  return request.body as z.output<B>;
}

export const refused = (status: number, code: string, message: string) =>
  new HttpError(status, code, message);

/** An address the person typed, checked with a sentence they can act on. */
export function addressFrom(value: string): string {
  const email = normalizeEmail(value);
  if (!looksLikeEmail(email)) throw refused(400, 'bad_email', 'Enter a valid email address.');
  return email;
}

export function toMe(user: SignedIn | null): Me {
  if (!user) return { signedIn: false };
  return {
    signedIn: true,
    email: user.email,
    role: user.role,
    memberships: user.memberships,
    grantsAccess: grantsAccess(user),
    tester: user.tester,
  };
}

export const iso = (d: Date) => d.toISOString();
export const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
