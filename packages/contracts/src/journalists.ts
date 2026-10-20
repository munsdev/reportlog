/**
 * The journalist alert list: sign up, confirm by link, leave by link.
 *
 * Signing up collects a name, an outlet, an address and the states a
 * journalist covers, and nothing else. Being on the list grants no access
 * to anything that is not public.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

export const JournalistSignup = z.object({
  name: z.string().trim().min(1).max(120),
  outlet: z.string().trim().min(1).max(160),
  email: z.string().trim().min(3).max(254),
  /** Place codes such as `US-AZ`. */
  states: z.array(z.string().max(12)).min(1).max(60),
});
export type JournalistSignup = z.infer<typeof JournalistSignup>;

export const signUpForAlerts = defineRoute({
  method: 'POST',
  path: '/api/journalists/signup',
  summary:
    'Ask to be on the journalist alert list. Sends a confirmation email; the answer is the same whether or not the address is already known.',
  body: JournalistSignup,
  response: z.object({ ok: z.literal(true) }),
});

/**
 * What an emailed link says. `gone` is an unknown link and an expired one
 * alike, so the page cannot be used to learn whose address is on the list.
 */
export const AlertLink = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('pending'),
    /** Partly hidden: enough to tell one's own addresses apart. */
    address: z.string(),
    states: z.array(z.string()),
  }),
  z.object({
    state: z.literal('active'),
    address: z.string(),
    states: z.array(z.string()),
  }),
  z.object({ state: z.literal('confirmed'), address: z.string() }),
  z.object({ state: z.literal('stopped') }),
  z.object({ state: z.literal('gone') }),
]);
export type AlertLink = z.infer<typeof AlertLink>;

const LinkParams = z.object({ token: z.string().max(128) });

export const describeAlertConfirm = defineRoute({
  method: 'GET',
  path: '/api/journalists/confirm/:token',
  summary: 'What a confirmation link would do. Changes nothing: mail scanners open links.',
  params: LinkParams,
  response: AlertLink,
});

export const confirmAlerts = defineRoute({
  method: 'POST',
  path: '/api/journalists/confirm/:token',
  summary: 'Put the address on the alert list. Only this call does.',
  params: LinkParams,
  response: AlertLink,
});

export const describeAlertStop = defineRoute({
  method: 'GET',
  path: '/api/journalists/stop/:token',
  summary: 'What the unsubscribe link in an alert would do. Changes nothing.',
  params: LinkParams,
  response: AlertLink,
});

export const stopAlerts = defineRoute({
  method: 'POST',
  path: '/api/journalists/stop/:token',
  summary: 'Take the address off the alert list. No sign-in needed.',
  params: LinkParams,
  response: AlertLink,
});
