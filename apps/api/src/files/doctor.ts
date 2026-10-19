/**
 * What the doctor (workstream H) says about files: whether they are taken,
 * whether storage answers, whether the tools are installed, and whether the
 * worker is keeping up.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Config } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { Finding } from '../jobs/doctor-checks.ts';
import { filesFrom } from './context.ts';
import { PACKAGE_FOR, missingToolsFor } from './media.ts';
import { randomKey, readAll } from './storage.ts';
import { STALE_MINUTES } from './worker.ts';

const finding = (status: Finding['status'], detail: string): Finding => ({
  status,
  check: 'files',
  detail,
});

export async function filesDoctorCheck(input: {
  config: Config;
  db: Database;
}): Promise<Finding[]> {
  const files = filesFrom(input.db, input.config);
  if (typeof files === 'string') {
    return [
      finding(
        'warn',
        `not taken: ${files}. Set FILES_KEY and the storage settings to take photos and video.`,
      ),
    ];
  }
  const out: Finding[] = [];

  // Storage, end to end: a small object written, read back and removed.
  const key = randomKey('doctor');
  const body = randomBytes(64);
  try {
    await files.storage.put('staging', key, body, body.length);
    const back = await files.storage.get('staging', key);
    if (!back || !(await readAll(back)).equals(body))
      throw new Error('what came back is not what was written');
    await files.storage.delete('staging', key);
    out.push(finding('ok', `${files.storage.kind} storage answers: write, read, delete`));
  } catch (err) {
    out.push(
      finding(
        'fail',
        `storage does not answer: ${(err as Error).message}. Run files:storage-check for each bucket.`,
      ),
    );
  }

  // The tools, by what is missing for which kind of file.
  const missing = new Set<string>();
  for (const type of ['image/jpeg', 'image/heic', 'video/mp4', 'application/pdf']) {
    for (const bin of await missingToolsFor(type)) missing.add(PACKAGE_FOR[bin] ?? bin);
  }
  out.push(
    missing.size
      ? finding('warn', `files that need them wait: install ${[...missing].join(', ')}`)
      : finding('ok', 'ImageMagick (with HEIC), ffmpeg and poppler are installed'),
  );

  // Is the worker keeping up? Released files waiting longer than an
  // interrupted attempt takes to be retried mean nothing is running it.
  const waiting = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM upload_slots
     WHERE status = 'uploaded' AND released_at IS NOT NULL
       AND released_at < now() - make_interval(mins => ${STALE_MINUTES})`.execute(input.db);
  const stuck = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM storage_deletions WHERE attempts >= 3`.execute(input.db);
  const w = waiting.rows[0]?.n ?? 0;
  const s = stuck.rows[0]?.n ?? 0;
  out.push(
    w
      ? finding(
          'fail',
          `${String(w)} sent file(s) waiting over ${String(STALE_MINUTES)} minutes: is the files timer running? (journalctl -u reportlog-job@files)`,
        )
      : finding('ok', 'the media worker is keeping up'),
  );
  if (s) {
    out.push(
      finding(
        'warn',
        `${String(s)} object(s) could not be deleted from storage after three tries; the worker keeps trying. Check storage_deletions.last_error.`,
      ),
    );
  }
  return out;
}
