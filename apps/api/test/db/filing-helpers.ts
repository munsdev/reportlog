/**
 * What the filing tests share: an app that can take reports (it has a
 * CONTACT_KEY), and filing one the way a reporter does, through the routes,
 * reading the link out of the email it was sent.
 */
import { cardFor } from '@reportlog/seal';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import type { Database } from '../../src/db/database.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import type { CapturingMailer } from '../../src/email/mailer.ts';
import { keyringFrom } from '../../src/filing/contactKeys.ts';
import { testDatabase } from './helpers.ts';
import { doorPass } from '../door-pass.ts';
import { SITE } from './identity-helpers.ts';

/** A test key. Never a deployment's. */
export const CONTACT_KEY = Buffer.alloc(32, 7).toString('base64');
export const RING = keyringFrom(CONTACT_KEY);
export const GENERAL = cardFor('general').digest;
export const COORDINATOR = cardFor('coordinator').digest;

export interface FilingHarness {
  db: Database;
  app: FastifyInstance;
  mailer: CapturingMailer;
  logs: string[];
  close(): Promise<void>;
}

export async function filingHarness(
  opts: { contactKey?: string | null; previousContactKey?: string; sendsPerClient?: number } = {},
): Promise<FilingHarness> {
  const db = testDatabase();
  const mailer = capturingMailer();
  const logs: string[] = [];
  const app = await buildApp({
    config: {
      LOG_LEVEL: 'info',
      SITE_ORIGIN: SITE,
      ...(opts.contactKey === null ? {} : { CONTACT_KEY: opts.contactKey ?? CONTACT_KEY }),
      ...(opts.previousContactKey ? { CONTACT_KEY_PREVIOUS: opts.previousContactKey } : {}),
      ...(opts.sendsPerClient ? { FILING_SENDS_PER_CLIENT: opts.sendsPerClient } : {}),
    },
    db,
    mailer,
    logStream: { write: (line) => logs.push(line) },
  });
  return {
    db,
    app,
    mailer,
    logs,
    async close() {
      await app.close();
      await db.destroy();
    },
  };
}

/** The confirmation token in the newest message to this address. */
export function tokenFor(mailer: CapturingMailer, email: string): string | undefined {
  const text = mailer.lastTo(email)?.text ?? '';
  return /\/file\/confirm\/([a-f0-9]{64})\b/.exec(text)?.[1];
}

/**
 * Send a report as the form does, with the door's fields (test/door-pass.ts).
 * A key in `body` wins, so a door test can send a bad one, or none (`''`).
 */
export async function send(h: FilingHarness, body: Record<string, unknown>) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/reports',
    payload: { ...(await doorPass(h.app)), ...body },
  });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

/** The spine, answered: an address, the statement, and "yes, publish". */
export const spine = (email: string, extra: Record<string, unknown> = {}) => ({
  email,
  consent: true,
  may_publish: true,
  may_publish_digest: GENERAL,
  ...extra,
});

export async function look(h: FilingHarness, token: string) {
  const res = await h.app.inject({ method: 'GET', url: `/api/reports/confirm/${token}` });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

export async function confirm(h: FilingHarness, token: string) {
  const res = await h.app.inject({ method: 'POST', url: `/api/reports/confirm/${token}` });
  return {
    status: res.statusCode,
    body: res.json<{
      confirmation: { state: string; public_ref?: string };
      just_confirmed: boolean;
      error?: { code: string; message: string };
    }>(),
  };
}

/** Send and confirm; returns the public reference. */
export async function fileThroughRoutes(
  h: FilingHarness,
  logbook: string,
  answers: Record<string, unknown>,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const sent = await send(h, { ...spine(email, extra), logbook, answers });
  if (sent.status !== 200) throw new Error(`sending failed: ${JSON.stringify(sent.body)}`);
  const token = tokenFor(h.mailer, email);
  if (!token) throw new Error('no confirmation link was emailed');
  const done = await confirm(h, token);
  const ref = done.body.confirmation.public_ref;
  if (!ref) throw new Error(`confirming failed: ${JSON.stringify(done.body)}`);
  return ref;
}

/** The spine of a form that asks for no address (E1): consent and the publication answer. */
export const spineWithoutEmail = (extra: Record<string, unknown> = {}) => ({
  consent: true,
  may_publish: true,
  may_publish_digest: GENERAL,
  ...extra,
});

/**
 * Send a report to a logbook that asks for no email (owner decision E1): it
 * is sealed on arrival. Returns the public reference of the newest report in
 * that logbook, which this send just made.
 */
export async function fileOnArrival(
  h: FilingHarness,
  logbook: string,
  answers: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const sent = await send(h, { ...spineWithoutEmail(extra), logbook, answers });
  if (sent.status !== 200 || sent.body.filed !== true)
    throw new Error(`sending failed: ${JSON.stringify(sent.body)}`);
  const row = await h.db
    .selectFrom('reports as r')
    .innerJoin('logbooks as l', 'l.id', 'r.logbook_id')
    .select('r.public_ref')
    .where('l.slug', '=', logbook)
    .orderBy('r.id', 'desc')
    .executeTakeFirstOrThrow();
  return row.public_ref;
}

export async function threadOf(db: Database, publicRef: string): Promise<string> {
  const row = await db
    .selectFrom('reports')
    .select('thread_id')
    .where('public_ref', '=', publicRef)
    .executeTakeFirstOrThrow();
  return row.thread_id;
}
