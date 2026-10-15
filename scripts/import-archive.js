/**
 * Replay an exported archive into an empty database, building a NEW chain.
 *
 * What this is not: a restore. The reports come back with their original
 * text, references and dates, but every content_hash and chain_hash is
 * computed afresh, because the hashed object's shape is whatever the
 * current code says it is. The result is a valid archive that is NOT the
 * archive it came from.
 *
 * That distinction is the whole reason the transparency log needs a reset
 * marker alongside a run of this. Anchors published against the old chain
 * name a head that no longer exists, and an archive that quietly stops
 * reconciling with its own published anchors is indistinguishable from one
 * that has been tampered with. Say it happened, in public, or do not do it.
 *
 * Refuses to run against a database that already holds reports. Replaying
 * into a populated chain would interleave two histories.
 */
import 'dotenv/config';
import fs from 'node:fs';
import { pool } from '../src/db.js';
import { insertReportVersion } from '../src/reportCore.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-archive.js <file.json>');
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(file, 'utf8'));

// A bytea column comes out of pg as a Buffer, and JSON.stringify writes a
// Buffer as {"type":"Buffer","data":[...]}. Handed back to pg as that
// object it is not bytes, and the encrypted contact details could not be
// restored. Turned back into a Buffer here, for every value that has the
// shape.
const bytes = (v) => (v && v.type === 'Buffer' && Array.isArray(v.data) ? Buffer.from(v.data) : v);

const client = await pool.connect();
try {
  const { rows: existing } = await client.query('SELECT count(*)::int AS n FROM reports');
  if (existing[0].n > 0) {
    console.error(`Refusing to import: ${existing[0].n} reports already present.`);
    console.error('Import replays a whole archive and expects an empty one.');
    process.exit(1);
  }

  await client.query('BEGIN');

  // Accounts first — reports are tied to reporters by email hash, and a
  // report whose owner is missing is one nobody can reach afterwards.
  for (const u of payload.users || []) {
    const cols = Object.keys(u);
    await client.query(
      `INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT DO NOTHING`,
      cols.map((c) => u[c]),
    );
  }

  // Organizations before reports, because a third-party report points at
  // one. Ids are carried across rather than reassigned: they appear in
  // reports.organization_id and in role_audit, and remapping two tables to
  // save a sequence value buys nothing.
  const orgIdMap = new Map();
  for (const org of payload.organizations || []) {
    const cols = Object.keys(org).filter((c) => c !== 'id');
    const { rows: [made] } = await client.query(
      `INSERT INTO organizations (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (name) DO UPDATE SET details = EXCLUDED.details
       RETURNING id`,
      cols.map((c) => org[c]),
    );
    orgIdMap.set(String(org.id), made.id);
  }
  for (const m of payload.organization_memberships || []) {
    const { rows: user } = await client.query('SELECT id FROM users WHERE email = $1', [m.email]);
    const orgId = orgIdMap.get(String(m.organization_id));
    if (!user.length || !orgId) continue;
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [orgId, user[0].id, m.role, m.joined_at],
    );
  }
  for (const inv of payload.organization_invites || []) {
    const orgId = orgIdMap.get(String(inv.organization_id));
    if (!orgId) continue;
    await client.query(
      `INSERT INTO organization_invites (organization_id, email, role, invited_by, created_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (organization_id, email) DO NOTHING`,
      [orgId, inv.email, inv.role, inv.invited_by, inv.created_at],
    );
  }
  for (const a of payload.role_audit || []) {
    await client.query(
      `INSERT INTO role_audit (actor_email, subject_email, axis, action, detail, organization_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [a.actor_email, a.subject_email, a.axis, a.action, a.detail,
        a.organization_id ? orgIdMap.get(String(a.organization_id)) || null : null, a.created_at],
    );
  }

  // LOGBOOKS FIRST, with their questions, exactly as they were — launched
  // ones stay launched, since reports were filed against those questions.
  const logbookIdMap = new Map();
  for (const l of payload.logbooks || []) {
    const { fields: qs = [], forms: _forms, id: oldId, ...rec } = l;
    const cols = Object.keys(rec);
    const { rows: [made] } = await client.query(
      `INSERT INTO logbooks (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, slug`,
      cols.map((c) => rec[c]),
    );
    logbookIdMap.set(String(oldId), made);
    for (const q of qs) {
      const { id: _qid, logbook_id: _lid, ...qrec } = q;
      const qcols = Object.keys(qrec);
      await client.query(
        `INSERT INTO logbook_fields (logbook_id, ${qcols.join(', ')})
         VALUES ($1, ${qcols.map((_, i) => `$${i + 2}`).join(', ')})`,
        [made.id, ...qcols.map((c) => (c === 'settings' ? JSON.stringify(qrec[c]) : qrec[c]))],
      );
    }
  }

  // The form versions come across with the logbooks, text untouched, so the
  // same bytes hash to the same value. Old id -> new id, for the reports.
  const formIdMap = new Map();
  for (const l of payload.logbooks || []) {
    for (const f of l.forms || []) {
      const { rows: [made] } = await client.query(
        `INSERT INTO logbook_forms (logbook_id, form_hash, definition)
         VALUES ($1, $2, $3) RETURNING id`,
        [logbookIdMap.get(String(l.id)).id, f.form_hash, f.definition],
      );
      formIdMap.set(String(f.id), made.id);
    }
  }

  // Old id -> new id, built as we go. Corrections point at the version they
  // correct, and those ids are assigned by the sequence, not carried over.
  const idMap = new Map();
  // Old attachment id -> new. A version's `carries` list names files by the
  // exporting archive's ids, and a file may be carried by a LATER version
  // than the one that created it, so the map has to outlive the inner loop.
  const attIdMap = new Map();
  let count = 0;

  for (const thread of payload.threads) {
    for (const v of thread.versions) {
      // The same fields normalizeReportFields writes, rebuilt from the
      // exported row: the logbook's slug, the answers if any, provenance if
      // a coordinator filed it, and the publication answer.
      const lb = logbookIdMap.get(String(v.logbook_id));
      if (!lb) throw new Error(`report ${v.public_ref} names a logbook the export does not carry`);
      const fields = {
        logbook: lb.slug,
        ...(v.answers && Object.keys(v.answers).length ? { answers: v.answers } : {}),
        ...(v.third_party ? {
          third_party: true,
          filed_via: v.filed_via,
          intake_method: v.intake_method,
          attested_at: v.attested_at instanceof Date
            ? v.attested_at.toISOString() : v.attested_at,
          ...(v.collected_on ? { collected_on: toDateString(v.collected_on) } : {}),
        } : {}),
        may_publish: v.may_publish,
        may_publish_digest: v.may_publish_digest,
      };
      // FROM WHAT THE VERSION COMMITTED TO, which is `carries` since
      // migration 033 — every file it held, inherited ones included. An
      // archive written before 033 has no `carries`, and for those
      // `attachments` is the same set: a correction could not carry a file
      // forward at all then, so the only files a version had were the ones
      // that arrived with it.
      //
      // Getting this wrong would be silent and permanent: a corrected
      // report replayed from the arrivals alone would hash a shorter
      // manifest than the original did, and its content hash would not
      // match the one in the archive it came from.
      const manifestSource = (v.carries && v.carries.length)
        ? v.carries : (v.attachments || []);
      const manifest = manifestSource
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((a) => ({
          ordinal: a.ordinal,
          sha256: a.sha256,
          byte_size: Number(a.byte_size),
          media_type: a.media_type,
        }));

      const row = await insertReportVersion(client, {
        threadId: v.thread_id,
        attachmentManifest: manifest.length ? manifest : null,
        organizationId: v.organization_id ? orgIdMap.get(String(v.organization_id)) || null : null,
        sourceRef: v.source_ref || null,
        correctsId: v.corrects_id ? idMap.get(String(v.corrects_id)) ?? null : null,
        fields,
        publicRef: v.public_ref,
        receivedAt: new Date(v.received_at).toISOString(),
        logbookId: lb.id,
        // The version it was filed under, or none for a report that never
        // had one — never the current questions, which it was not asked.
        formId: v.form_id ? formIdMap.get(String(v.form_id)) ?? null : null,
      });
      idMap.set(String(v.id), row.id);
      count += 1;

      for (const a of v.attachments || []) {
        const { head, ...att } = a;
        const rec = { ...att, report_id: row.id };
        delete rec.id;
        delete rec.carries;
        const cols = Object.keys(rec);
        const { rows: [inserted] } = await client.query(
          `INSERT INTO attachments (${cols.join(', ')})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
          cols.map((c) => rec[c]),
        );
        attIdMap.set(String(a.id), inserted.id);
        if (head) {
          const h = { ...head, attachment_id: inserted.id };
          const hcols = Object.keys(h);
          await client.query(
            `INSERT INTO attachment_heads (${hcols.join(', ')})
             VALUES (${hcols.map((_, i) => `$${i + 1}`).join(', ')})
             ON CONFLICT DO NOTHING`,
            hcols.map((c) => h[c]),
          );
        }
      }

      // The links, after the rows: a version may carry a file that arrived
      // with an earlier version of the same thread, and those rows exist
      // because the thread is replayed in order.
      //
      // Falls back to the files that arrived here, so an archive written
      // before migration 033 still gets a complete link table rather than
      // an empty one — which would make every replayed report look as
      // though it had no files.
      const carried = (v.carries && v.carries.length)
        ? v.carries.map((a) => attIdMap.get(String(a.id))).filter(Boolean)
        : (v.attachments || []).map((a) => attIdMap.get(String(a.id))).filter(Boolean);
      for (const attachmentId of carried) {
        await client.query(
          `INSERT INTO report_attachments (report_id, attachment_id) VALUES ($1, $2)
           ON CONFLICT (report_id, attachment_id) DO NOTHING`,
          [row.id, attachmentId],
        );
      }
    }

    // The head last: it points at the newest version, which only exists
    // once every version in the thread has been replayed.
    if (thread.head) {
      const h = { ...thread.head };
      h.current_report_id = idMap.get(String(h.current_report_id));
      const cols = Object.keys(h);
      await client.query(
        `INSERT INTO report_heads (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
         ON CONFLICT (thread_id) DO UPDATE SET current_report_id = EXCLUDED.current_report_id`,
        cols.map((c) => h[c]),
      );
    }

    // After the head, because the foreign key points at it. Thread ids
    // carry over unchanged, so nothing here needs remapping.
    // The thread's contact key before its restricted row, which cannot be
    // read without it. Absent when it was erased, which stays erased.
    if (thread.contact_key) {
      const k = thread.contact_key;
      await client.query(
        'INSERT INTO contact_keys (thread_id, dek_wrapped, contact_email_hmac, created_at) VALUES ($1,$2,$3,$4)',
        [k.thread_id, bytes(k.dek_wrapped), k.contact_email_hmac, k.created_at],
      );
    }
    if (thread.restricted) {
      const cols = Object.keys(thread.restricted);
      await client.query(
        `INSERT INTO reports_restricted (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        cols.map((c) => bytes(thread.restricted[c])),
      );
    }
  }

  // The site-wide password gate. Restored before anything else that could
  // let a visitor in, because the app reads a MISSING row as
  // access_enabled: false — so an archive rebuilt without this comes back
  // up with the gate silently switched off and the site open. Found the
  // hard way during the first reset, one command before the site was
  // started.
  for (const st of payload.site_settings || []) {
    const cols = Object.keys(st);
    await client.query(
      `INSERT INTO site_settings (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id')
    .map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
      cols.map((c) => st[c]),
    );
  }

  // Everything below is keyed by thread or by nothing, so it carries over
  // as it stands. chain_anchors is deliberately NOT among it: those anchors
  // describe the chain this import replaced.
  for (const [table, rows] of [
    ['access_log', payload.access_log], ['feedback', payload.feedback],
    ['feedback_events', payload.feedback_events],
  ]) {
    for (const r of rows || []) {
      const rec = { ...r };
      delete rec.id;
      const cols = Object.keys(rec);
      if (!cols.length) continue;
      await client.query(
        `INSERT INTO ${table} (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`,
        cols.map((c) => rec[c]),
      );
    }
  }

  await client.query('COMMIT');
  console.log(`  threads   ${payload.threads.length}`);
  console.log(`  reports   ${count}`);
  console.log(`  orgs      ${(payload.organizations || []).length}`);
  console.log(`  settings  ${(payload.site_settings || []).length} `
    + `(the password gate — 0 here means the site comes up OPEN)`);
  // One chain per logbook, so one head per logbook, old and new.
  const { rows: heads } = await client.query(
    `SELECT DISTINCT ON (r.logbook_id) l.slug, r.chain_hash
       FROM reports r JOIN logbooks l ON l.id = r.logbook_id
      ORDER BY r.logbook_id, r.id DESC`,
  );
  const old = payload.previous_chain_heads || {};
  let same = true;
  for (const h of heads) {
    console.log(`\n  ${h.slug}\n    old head  ${old[h.slug] || '(none)'}\n    new head  ${h.chain_hash}`);
    if (old[h.slug] !== h.chain_hash) same = false;
  }
  console.log(same
    ? '\nThe heads match: nothing about the hashed shape changed for this data.'
    : '\nThe heads differ, and that is correct — these are new chains.');
  console.log('Publish the reset marker to the transparency log.');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(err.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}

// Matches toDateString in src/verify.js — the hashed form of a date is
// always the bare 'YYYY-MM-DD', never a zone-rendered datetime.
function toDateString(v) {
  if (!v) return v;
  if (typeof v === 'string') return v.slice(0, 10);
  return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
}
