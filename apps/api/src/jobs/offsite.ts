/**
 * Sending an encrypted backup to EU object storage over the S3 API.
 *
 * Any S3-compatible provider works; the ones this was written for are
 * Hetzner Object Storage and Scaleway Object Storage, both in the EU.
 *
 * THE SERVER CAN WRITE, AND SHOULD NOT BE ABLE TO DELETE. Give the key this
 * uses permission to put objects and nothing else, and let the bucket's own
 * lifecycle rule expire old ones (deploy/README.md). Then somebody who takes
 * over the server can add files to the bucket and cannot empty it, which is
 * the moment a backup is for. So this module only ever uploads.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export interface OffsiteTarget {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Uploader {
  upload(file: string, key: string): Promise<{ bytes: number }>;
}

export function s3Uploader(target: OffsiteTarget): Uploader {
  const client = new S3Client({
    endpoint: target.endpoint,
    region: target.region,
    credentials: { accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey },
    // Path-style URLs work on every S3-compatible provider; bucket-name
    // hostnames do not everywhere.
    forcePathStyle: true,
    // Recent AWS SDKs add checksum headers that several non-AWS providers
    // reject. Only send them where the operation requires one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return {
    async upload(file, key) {
      const { size } = await stat(file);
      // Multipart for anything large, so a dump of any size goes up in
      // pieces and one dropped connection costs one piece.
      await new Upload({
        client,
        params: { Bucket: target.bucket, Key: key, Body: createReadStream(file) },
        partSize: 64 * 1024 * 1024,
        queueSize: 2,
      }).done();
      return { bytes: size };
    },
  };
}

export function offsiteTarget(config: {
  BACKUP_S3_ENDPOINT?: string | undefined;
  BACKUP_S3_REGION?: string | undefined;
  BACKUP_S3_BUCKET?: string | undefined;
  BACKUP_S3_PREFIX: string;
  BACKUP_S3_ACCESS_KEY_ID?: string | undefined;
  BACKUP_S3_SECRET_ACCESS_KEY?: string | undefined;
}): OffsiteTarget | undefined {
  const {
    BACKUP_S3_ENDPOINT: endpoint,
    BACKUP_S3_REGION: region,
    BACKUP_S3_BUCKET: bucket,
    BACKUP_S3_ACCESS_KEY_ID: accessKeyId,
    BACKUP_S3_SECRET_ACCESS_KEY: secretAccessKey,
  } = config;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return undefined;
  return {
    endpoint,
    region,
    bucket,
    prefix: config.BACKUP_S3_PREFIX,
    accessKeyId,
    secretAccessKey,
  };
}
