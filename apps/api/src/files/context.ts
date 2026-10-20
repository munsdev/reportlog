/**
 * What the files code needs from the deployment: somewhere to put bytes and
 * the key to wrap each file's key under. Built once from configuration.
 *
 * Either may be missing. Then files are not taken at all, the form does not
 * offer its upload question, and the reason is logged once at start, rather
 * than a half-configured site accepting uploads it cannot keep, which would
 * lose evidence silently.
 */
import { resolve } from 'node:path';
import type { Kysely } from 'kysely';
import type { Config } from '../config.ts';
import type { DB } from '../db/schema.gen.ts';
import { filesKeyring } from './envelope.ts';
import type { FilesKeyring } from './envelope.ts';
import { attachmentsEnabled, siteLayer } from './limits.ts';
import { BUCKETS, bucketNameProblem, diskStorage, s3Storage } from './storage.ts';
import type { Storage } from './storage.ts';

export type FilesConfig = Partial<
  Pick<
    Config,
    | 'FILES_KEY'
    | 'FILES_STORAGE'
    | 'FILES_DIR'
    | 'S3_ENDPOINT'
    | 'S3_REGION'
    | 'S3_ACCESS_KEY'
    | 'S3_SECRET_KEY'
    | 'S3_BUCKET_STAGING'
    | 'S3_BUCKET_EVIDENCE'
    | 'S3_BUCKET_RENDITIONS'
    | 'S3_ADDRESSING'
    | 'ATTACHMENTS_ENABLED'
    | 'FILES_STAGING_QUOTA_REPORTS'
    | 'CLAMAV_ENABLED'
  >
>;

export interface Files {
  db: Kysely<DB>;
  storage: Storage;
  ring: FilesKeyring;
  /** The environment's answer where an administrator has not given one. */
  envDefault: boolean;
  quotaReports: number;
  clamav: boolean;
}

/** The storage this configuration names, or why there is none. */
export function storageFrom(c: FilesConfig): Storage | string {
  if (c.FILES_STORAGE === 'disk') return diskStorage(resolve(c.FILES_DIR ?? '.files'));
  if (c.FILES_STORAGE === 's3') {
    const missing = (
      [
        'S3_ENDPOINT',
        'S3_ACCESS_KEY',
        'S3_SECRET_KEY',
        'S3_BUCKET_STAGING',
        'S3_BUCKET_EVIDENCE',
        'S3_BUCKET_RENDITIONS',
      ] as const
    ).filter((k) => !c[k]);
    if (missing.length)
      return `FILES_STORAGE is s3 but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`;
    const buckets = {
      staging: c.S3_BUCKET_STAGING ?? '',
      evidence: c.S3_BUCKET_EVIDENCE ?? '',
      renditions: c.S3_BUCKET_RENDITIONS ?? '',
    };
    const addressing = c.S3_ADDRESSING ?? 'path';
    for (const b of BUCKETS) {
      const problem = bucketNameProblem(addressing, buckets[b]);
      if (problem) return problem;
    }
    return s3Storage({
      endpoint: c.S3_ENDPOINT ?? '',
      region: c.S3_REGION ?? 'eu-central-1',
      accessKey: c.S3_ACCESS_KEY ?? '',
      secretKey: c.S3_SECRET_KEY ?? '',
      addressing,
      buckets,
    });
  }
  return 'FILES_STORAGE is not set';
}

/** The files context, or the sentence saying why files are not taken. */
export function filesFrom(db: Kysely<DB>, c: FilesConfig): Files | string {
  if (!c.FILES_KEY) return 'FILES_KEY is not set';
  const storage = storageFrom(c);
  if (typeof storage === 'string') return storage;
  return {
    db,
    storage,
    ring: filesKeyring(c.FILES_KEY),
    // Configured storage and a key are the operator saying "files": on unless
    // the environment or an administrator says otherwise.
    envDefault: c.ATTACHMENTS_ENABLED !== 'false',
    quotaReports: c.FILES_STAGING_QUOTA_REPORTS ?? 3,
    clamav: c.CLAMAV_ENABLED === 'true',
  };
}

/** Are files being taken right now? */
export async function filesOn(files: Files | null): Promise<boolean> {
  if (!files) return false;
  const site = await siteLayer(files.db);
  return attachmentsEnabled(site.enabled, { configured: true, envDefault: files.envDefault });
}
