/**
 * Filing one entry on a list.
 *
 * AN ENTRY IS NOT A REPORT. It has no spine: the address is the list's one
 * built-in field rather than a consent-bearing contact detail, and there is no
 * publication answer. Nothing here seals, chains, or writes to the
 * transparency log, and the boundary check keeps it that way.
 *
 * NOTHING A SUBMITTER WRITES IS PUBLISHED. What leaves the building is counts
 * over questions an operator ticked, and only after a moderator approves.
 */
import type { AnswerValue } from '@reportlog/fields';
import { sql } from 'kysely';
import { mintErasureToken } from './erasure.ts';
import { prepareAnswers } from './policy.ts';
import type { PreparedLink } from './policy.ts';
import { isRefusalCode, refuse, sentenceFor } from './refusals.ts';
import type { ListRefusalCode } from './refusals.ts';
import { personalExpiresAt } from './retention.ts';
import type { ListSettings } from './retention.ts';
import { isAccepting, listBySlug } from './rows.ts';
import type { Db, LoadedList } from './rows.ts';
import { hashAddress } from './salt.ts';

export interface EntryInput {
  answers: Record<string, unknown>;
  email?: string | null | undefined;
  emailConsent?: boolean | undefined;
  /** The client's network address. Hashed under the day's secret, never written. */
  address?: string | null | undefined;
}

export interface FiledEntry {
  id: number;
  list: LoadedList;
  links: PreparedLink[];
  /** What was stored, for the new-entry email. Nothing new leaves here. */
  answers: Record<string, AnswerValue>;
  erasable: Record<string, AnswerValue> | null;
  email: string | null;
  personalExpiresAt: Date | null;
  /** The plaintext erasure secret, for the email. The only moment it exists. */
  erasureToken: string | null;
}

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/** A visitor's refusal, naming the question it is about. */
function refuseAnswer(list: LoadedList, reason: string, key?: string): never {
  const field = key ? list.fields.find((f) => f.key === key) : undefined;
  const code: ListRefusalCode = isRefusalCode(reason) ? reason : 'not-an-answer';
  const sentence = sentenceFor(code);
  return refuse(code, field ? `“${field.label}”: ${sentence}` : sentence, key ?? null);
}

/**
 * File one. Refuses with a ListRefusal, whose sentence a visitor can act on.
 *
 * Every check is HERE rather than trusted from the form or left to a route: a
 * form somebody had open when intake closed must not be able to submit, and an
 * import path added later must not be able to write a row that holds somebody's
 * words with no way to reach them.
 */
export async function fileEntry(
  db: Db,
  slug: string,
  input: EntryInput,
  { now = new Date(), settings }: { now?: Date; settings: ListSettings },
): Promise<FiledEntry> {
  const list = await listBySlug(db, slug);
  if (!list) return refuse('no-such-list');
  if (!isAccepting(list, now)) return refuse('closed');

  const prepared = prepareAnswers(list.fields, input.answers);
  if (!prepared.ok) return refuseAnswer(list, prepared.reason, prepared.key);

  const email = input.email ? input.email.trim().toLowerCase() : null;
  if (email && !EMAIL.test(email)) return refuse('not-an-email');

  // THE GATE, ON WHAT ACTUALLY ARRIVED. The form-level requirement says the
  // form may collect personal data, so it shows an address card; it does not
  // say every submission carries any. Somebody sending a link and two choices
  // has handed over nothing personal and must not be asked for an address.
  // A form with a REQUIRED free-text question is covered by the same line,
  // because a missing required answer was refused above.
  if (prepared.erasable && !email) return refuse('email-required-for-personal-data');
  // A form that always wants one: a way to reach the site. Added on top of the
  // gate, never instead of it.
  if (list.email_mode === 'required' && !email) return refuse('email-required');

  const expires = personalExpiresAt(now, settings.personalDays);
  const ipHash = await hashAddress(db, input.address ?? null);

  return db.transaction().execute(async (trx) => {
    const entry = await trx
      .insertInto('list_entries')
      .values({
        list_id: list.id,
        answers: JSON.stringify(prepared.answers),
        erasable_answers: prepared.erasable ? JSON.stringify(prepared.erasable) : null,
        email,
        email_consent: input.emailConsent === true,
        ip_hash: ipHash,
        personal_expires_at: expires,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    for (const l of prepared.links) {
      await trx
        .insertInto('list_entry_links')
        .values({
          entry_id: entry.id,
          field_key: l.fieldKey,
          url_raw: l.urlRaw,
          url_key: l.urlKey,
          host: l.host,
        })
        .execute();
      // The durable layer: one row per distinct link, with a count. It holds
      // no text and no submitter, so the sweep leaves it alone.
      await trx
        .insertInto('link_index')
        .values({ url_key: l.urlKey, host: l.host, submission_count: 1 })
        .onConflict((oc) =>
          oc.column('url_key').doUpdateSet({
            last_seen: sql<Date>`now()`,
            submission_count: sql<number>`link_index.submission_count + 1`,
          }),
        )
        .execute();
    }

    // Only where there is both something to erase and somewhere to send the
    // link: a token with no address to mail it to can never be redeemed.
    const holdsPersonal = Boolean(prepared.erasable) || Boolean(email) || Boolean(ipHash);
    const erasureToken =
      holdsPersonal && email
        ? await mintErasureToken(
            trx,
            { entryId: entry.id, personalExpiresAt: expires },
            { now, linkDays: settings.erasureLinkDays },
          )
        : null;

    return {
      id: entry.id,
      list,
      links: prepared.links,
      answers: prepared.answers,
      erasable: prepared.erasable,
      email,
      personalExpiresAt: expires,
      erasureToken,
    };
  });
}
