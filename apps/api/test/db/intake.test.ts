/**
 * A coordinator filing accounts collected on paper, and the switch that
 * closes both doors into the chain.
 *
 * Ported from legacy/scripts/intake-selftest.mjs, intake-switch-selftest.mjs
 * and the chain half of orgs-selftest.mjs that workstream A left for this
 * one: a coordinator-filed report verifies, with the organization INSIDE the
 * seal and the coordinator (and their private reference to the paper)
 * OUTSIDE it.
 */
import { cardFor } from '@reportlog/seal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyReport } from '../../src/chain/verify.ts';
import { openContact } from '../../src/filing/contactKeys.ts';
import { launchedLogbook } from './helpers.ts';
import {
  GENERAL,
  RING,
  fileThroughRoutes,
  filingHarness,
  send,
  spine,
  threadOf,
} from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

let h: FilingHarness;
let lb: { id: number; slug: string };
let orgId: number;
const ORG = `Indivisible Abroad ${String(process.pid)}-${String(Date.now() % 1e6)}`;
const COORD = address('coord');
const CARD = cardFor('coordinator').digest;
let coord: ReturnType<typeof as>;

const call = async (
  who: ReturnType<typeof as>,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: Record<string, unknown>,
) => {
  const r = await who({ method, url, ...(body ? { payload: body } : {}) });
  return { status: r.statusCode, body: r.json<Record<string, unknown>>() };
};

beforeAll(async () => {
  h = await filingHarness();
  lb = await launchedLogbook(h.db, [
    { key: 'what_happened', kind: 'long_text', label: 'What happened?', required: true },
  ]);
  const userId = await seat(h.db, COORD, 'user');
  const org = await h.db
    .insertInto('organizations')
    .values({ name: ORG, verified_by: 'admin@example.org' })
    .returning('id')
    .executeTakeFirstOrThrow();
  orgId = org.id;
  await h.db
    .insertInto('organization_memberships')
    .values({ organization_id: orgId, user_id: userId, role: 'coordinator' })
    .execute();
  coord = as(h, await signIn(h, COORD));
});
afterAll(async () => {
  await h.db.updateTable('intake_settings').set({ intake_enabled: null }).execute();
  await h.close();
});

describe('who may file for an organization', () => {
  it('refuses somebody not signed in, and says it is not the site password', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/intake/organizations' });
    expect(r.statusCode).toBe(401);
    expect(r.json<{ error: { code: string } }>().error.code).toBe('not_signed_in');
  });

  it('refuses a signed-in person who coordinates nothing', async () => {
    const nobody = as(h, await signIn(h, address('nobody')));
    expect((await call(nobody, 'GET', '/api/intake/organizations')).status).toBe(403);
  });

  it('shows a coordinator their organization, and only lets them open batches for it', async () => {
    const orgs = await call(coord, 'GET', '/api/intake/organizations');
    expect(orgs.status).toBe(200);
    expect(orgs.body.organizations).toEqual([
      { organization_id: orgId, name: ORG, role: 'coordinator' },
    ]);
    expect(
      (await call(coord, 'POST', '/api/intake/batches', { organization_id: orgId + 999 })).status,
    ).toBe(403);
  });
});

describe('a batch, from typing up to filing', () => {
  let batchId: number;
  let refs: string[] = [];

  it('opens, takes three accounts, and reviews two ready and one blocked', async () => {
    const made = await call(coord, 'POST', '/api/intake/batches', { organization_id: orgId });
    expect(made.status).toBe(200);
    batchId = Number(made.body.id);
    for (const entry of [
      {
        logbook: lb.slug,
        answers: { what_happened: 'Told me she was turned away over a student ID at about nine.' },
        intake_method: 'paper',
        collected_on: '2026-11-03',
        source_ref: 'clipboard 3, entry 7',
        may_publish: true,
        may_publish_digest: CARD,
      },
      {
        logbook: lb.slug,
        answers: { what_happened: 'A second account off the same clipboard, about the queue.' },
        intake_method: 'paper',
        may_publish: false,
        may_publish_digest: CARD,
      },
      // No logbook, no method, no publication answer: stays staged.
      { answers: { what_happened: 'incomplete' } },
    ]) {
      const d = await call(coord, 'POST', `/api/intake/batches/${String(batchId)}/drafts`, {});
      const put = await call(coord, 'PUT', `/api/intake/drafts/${String(d.body.id)}`, entry);
      expect(put.status).toBe(200);
    }
    const review = await call(coord, 'GET', `/api/intake/batches/${String(batchId)}/review`);
    expect(review.body).toMatchObject({ ready: 2, blocked: 1 });
  });

  it('refuses the general card’s wording: the coordinator records the coordinators’ card', async () => {
    const d = await call(coord, 'POST', `/api/intake/batches/${String(batchId)}/drafts`, {
      logbook: lb.slug,
      answers: { what_happened: 'Wrong card' },
      intake_method: 'phone',
      may_publish: true,
      may_publish_digest: GENERAL,
    });
    const review = await call(coord, 'GET', `/api/intake/batches/${String(batchId)}/review`);
    const entry = (review.body.entries as { id: number; problems: string[] }[]).find(
      (e) => e.id === d.body.id,
    );
    expect(entry?.problems.join(' ')).toMatch(/coordinators/);
    expect((await call(coord, 'DELETE', `/api/intake/drafts/${String(d.body.id)}`)).status).toBe(
      200,
    );
  });

  it('will not file without the attestation', async () => {
    const r = await call(coord, 'POST', `/api/intake/batches/${String(batchId)}/submit`, {});
    expect(r.status).toBe(400);
  });

  it('files the two that were ready, and leaves the incomplete one staged', async () => {
    const r = await call(coord, 'POST', `/api/intake/batches/${String(batchId)}/submit`, {
      attested: true,
    });
    expect(r.status).toBe(200);
    const filed = r.body.filed as { public_ref: string }[];
    expect(filed).toHaveLength(2);
    expect(r.body.still_staged).toBe(1);
    refs = filed.map((f) => f.public_ref);

    const review = await call(coord, 'GET', `/api/intake/batches/${String(batchId)}/review`);
    expect(review.body).toMatchObject({ ready: 0, blocked: 1 });
    const batch = await call(coord, 'GET', `/api/intake/batches/${String(batchId)}`);
    expect(batch.body.batch).toMatchObject({ status: 'draft', entries: 3, filed: 2 });
  });

  it('each verifies, in its logbook, with its provenance and the answer the person gave', async () => {
    const seen = [];
    for (const ref of refs) {
      const v = await verifyReport(h.db, ref);
      expect(v?.content.ok && v.link.ok && v.position.ok).toBe(true);
      seen.push(v);
    }
    expect(seen.every((v) => v?.hashed_fields.logbook === lb.slug)).toBe(true);
    expect(seen.every((v) => v?.hashed_fields.third_party === true)).toBe(true);
    expect(seen.map((v) => v?.hashed_fields.may_publish).sort()).toEqual([false, true]);
    // One attestation, by one person, in one act.
    expect(new Set(seen.map((v) => v?.hashed_fields.attested_at)).size).toBe(1);
    // The same questions, so the same form version.
    expect(new Set(seen.map((v) => v?.hashed_fields.logbook_form)).size).toBe(1);
    expect(seen[0]?.hashed_fields.collected_on).toBe('2026-11-03');
    expect(seen[1]?.hashed_fields).not.toHaveProperty('collected_on');
  });

  it('THE ORGANIZATION IS INSIDE THE SEAL; THE COORDINATOR AND THEIR PAPER ARE NOT', async () => {
    const v = await verifyReport(h.db, refs[0] ?? '');
    expect(v?.hashed_fields.filed_via).toBe(ORG);
    expect(v?.canonical_json).toContain(ORG);
    expect(v?.canonical_json).not.toContain(COORD);
    expect(v?.canonical_json).not.toContain('clipboard 3');
    // The coordinator is the reachable, accountable person, outside the seal.
    const thread = await threadOf(h.db, refs[0] ?? '');
    expect(await openContact(h.db, RING, thread)).toMatchObject({
      filed_by: 'coordinator',
      email: COORD,
      organization: ORG,
    });
  });

  it('a filed account never changes again, and is not the coordinator’s "My reports"', async () => {
    const batch = await call(coord, 'GET', `/api/intake/batches/${String(batchId)}`);
    const filedDraft = (batch.body.drafts as { id: number; public_ref: string | null }[]).find(
      (d) => d.public_ref,
    );
    expect(
      (await call(coord, 'PUT', `/api/intake/drafts/${String(filedDraft?.id)}`, {})).status,
    ).toBe(409);
    expect(
      (await call(coord, 'DELETE', `/api/intake/drafts/${String(filedDraft?.id)}`)).status,
    ).toBe(409);
    await expect(
      h.db
        .deleteFrom('intake_drafts')
        .where('id', '=', filedDraft?.id ?? 0)
        .execute(),
    ).rejects.toThrow(/never changed or removed/);
    const mine = await call(coord, 'GET', '/api/mine/reports');
    expect(mine.body.reports).toEqual([]);
  });

  it('a renamed organization does not change a sealed report', async () => {
    await h.db
      .updateTable('organizations')
      .set({ name: `${ORG} (renamed)` })
      .where('id', '=', orgId)
      .execute();
    const v = await verifyReport(h.db, refs[0] ?? '');
    expect(v?.content.ok).toBe(true);
    expect(v?.hashed_fields.filed_via).toBe(ORG);
    await h.db.updateTable('organizations').set({ name: ORG }).where('id', '=', orgId).execute();
  });

  it('another coordinator cannot see or touch the batch', async () => {
    const other = address('coord2');
    const uid = await seat(h.db, other, 'user');
    await h.db
      .insertInto('organization_memberships')
      .values({ organization_id: orgId, user_id: uid, role: 'coordinator' })
      .execute();
    const them = as(h, await signIn(h, other));
    expect((await call(them, 'GET', `/api/intake/batches/${String(batchId)}`)).status).toBe(404);
    expect((await call(them, 'GET', '/api/intake/batches')).body.batches).toEqual([]);
  });
});

describe('somebody who has left the organization', () => {
  it('can no longer file a batch they opened while in it', async () => {
    const leaver = address('leaver');
    const uid = await seat(h.db, leaver, 'user');
    await h.db
      .insertInto('organization_memberships')
      .values({ organization_id: orgId, user_id: uid, role: 'coordinator' })
      .execute();
    const them = as(h, await signIn(h, leaver));
    const made = await call(them, 'POST', '/api/intake/batches', { organization_id: orgId });
    const id = String(made.body.id);
    await call(them, 'POST', `/api/intake/batches/${id}/drafts`, {
      logbook: lb.slug,
      answers: { what_happened: 'Typed up before leaving' },
      intake_method: 'paper',
      may_publish: false,
      may_publish_digest: CARD,
    });
    // Another organization keeps them a coordinator, so the scope still admits them.
    const other = await h.db
      .insertInto('organizations')
      .values({ name: `${ORG} elsewhere`, verified_by: 'admin@example.org' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('organization_memberships')
      .values({ organization_id: other.id, user_id: uid, role: 'coordinator' })
      .execute();
    await h.db
      .deleteFrom('organization_memberships')
      .where('organization_id', '=', orgId)
      .where('user_id', '=', uid)
      .execute();
    const r = await call(them, 'POST', `/api/intake/batches/${id}/submit`, { attested: true });
    expect(r.status).toBe(403);
    expect((await call(them, 'POST', `/api/intake/batches/${id}/drafts`, {})).status).toBe(403);
  });
});

describe('the intake switch', () => {
  const admin = address('switch-admin');
  let asAdmin: ReturnType<typeof as>;
  const setSwitch = (open: boolean | null) =>
    call(asAdmin, 'PUT', '/api/admin/intake-switch', { open });

  beforeAll(async () => {
    await seat(h.db, admin, 'admin');
    asAdmin = as(h, await signIn(h, admin));
  });

  it('is open on a site that was never asked, and only an administrator may set it', async () => {
    expect((await call(asAdmin, 'GET', '/api/admin/intake-switch')).body).toEqual({
      open: true,
      stored: null,
    });
    expect((await call(coord, 'PUT', '/api/admin/intake-switch', { open: false })).status).toBe(
      403,
    );
    expect((await h.app.inject({ method: 'GET', url: '/api/intake-switch' })).json()).toEqual({
      open: true,
    });
  });

  it('closed, the form refuses BEFORE judging the report, saying it is the site', async () => {
    expect((await setSwitch(false)).body).toEqual({ open: false, stored: false });
    expect((await h.app.inject({ method: 'GET', url: '/api/intake-switch' })).json()).toEqual({
      open: false,
    });
    // Deliberately an EMPTY body: a closed site is not a badly filled form.
    const r = await send(h, {});
    expect(r.status).toBe(503);
    expect((r.body.error as { code: string }).code).toBe('intake_closed');
  });

  it('closed, the coordinator door refuses too, before it looks anything up', async () => {
    const r = await call(coord, 'POST', '/api/intake/batches/999999/submit', { attested: true });
    expect(r.status).toBe(503);
    expect((r.body.error as { code: string }).code).toBe('intake_closed');
    // And a coordinator keeps their staged work.
    expect((await call(coord, 'GET', '/api/intake/batches')).status).toBe(200);
  });

  it('closing leaves the publication card and everything filed alone', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/publication-card' })).statusCode).toBe(
      200,
    );
  });

  it('reopened, an empty submission is judged on its own merits again', async () => {
    expect((await setSwitch(true)).body).toEqual({ open: true, stored: true });
    const r = await send(h, {});
    expect(r.status).toBe(400);
    await setSwitch(null);
    // And it files again.
    const ref = await fileThroughRoutes(
      h,
      lb.slug,
      { what_happened: 'After reopening' },
      address('reopen'),
    );
    expect(ref).toMatch(/^RL-/);
    expect((await send(h, { ...spine(address('x')), logbook: lb.slug, answers: {} })).status).toBe(
      400,
    );
  });
});
