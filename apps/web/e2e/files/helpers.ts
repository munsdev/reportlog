/**
 * What the files browser tests share: a real photo with a location in it, a
 * signed-in context made through the API (code read from the outbox), and
 * the files dev-state.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { expect } from '@playwright/test';
import { codeIn, countTo, lastMessageTo } from '../identity/mail.ts';
import { passSecondFactor } from '../second-factor.ts';

const API = fileURLToPath(new URL('../../../api/', import.meta.url));

export function filesState(...args: string[]): void {
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/files/dev-state.ts', ...args], {
    cwd: API,
  });
}

/**
 * A 64×48 photo whose EXIF names a camera and carries a GPS position, the
 * details re-encoding has to remove. Made by ImageMagick, then the EXIF
 * segment spliced in after the start-of-image marker.
 */
export function photoWithLocation(): Buffer {
  const jpg = execFileSync('convert', ['-size', '64x48', 'xc:red', '-strip', 'jpeg:-']);
  const tiff = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 + 4 + 8);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10); // GPSInfo
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x0001, 28); // GPSLatitudeRef
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(2, 32);
  tiff.write('N\0', 36, 'latin1');
  tiff.writeUInt32LE(0, 40);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpg.subarray(0, 2), head, body, jpg.subarray(2)]);
}

/** An API context signed in as this address, by the code the server emailed. */
export async function signedIn(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
  email: string,
): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL });
  const before = countTo(email);
  expect((await ctx.post('/api/auth/code', { data: { email } })).ok()).toBe(true);
  const code = codeIn(await lastMessageTo(email, before));
  const r = await ctx.post('/api/auth/sign-in', { data: { email, code } });
  expect(r.ok(), await r.text()).toBe(true);
  await passSecondFactor(ctx, email);
  return ctx;
}
