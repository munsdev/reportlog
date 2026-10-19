/**
 * Which release this server is, for the footer's version line. Read once,
 * when the routes are registered, never per request.
 *
 * Two answers to two questions. `release` is the number a person quotes
 * ("which release am I on?"), from the repository's package.json. `build`
 * is the exact commit a deployment unpacked (deploy.sh writes it to
 * REVISION), which is what a bug report needs. Either may be missing: a
 * development checkout has no REVISION, and the repository may not number
 * its releases yet. A missing one is null, and the footer leaves it out
 * rather than showing a made-up number.
 */
import type { SiteVersion } from '@reportlog/contracts';
import { readFileSync } from 'node:fs';
import { releaseOf } from '../telemetry/tracker.ts';

/** A plain semantic version, the same rule as the update check's. */
const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function releaseIn(packageJson: string | null): string | null {
  if (!packageJson) return null;
  try {
    const v = (JSON.parse(packageJson) as { version?: unknown }).version;
    return typeof v === 'string' && SEMVER.test(v) ? `v${v.replace(/^v/, '')}` : null;
  } catch {
    return null;
  }
}

function readOrNull(file: URL): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function readVersion(
  packageJson: URL = new URL('../../../../package.json', import.meta.url),
  revision: URL = new URL('../../../../REVISION', import.meta.url),
): SiteVersion {
  const sha = releaseOf(revision);
  return { release: releaseIn(readOrNull(packageJson)), build: sha ? sha.slice(0, 12) : null };
}
