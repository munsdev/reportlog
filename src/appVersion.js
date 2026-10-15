// Which build a bug was seen on — the single most useful piece of context
// on a tester's report. Deploys here are a `git pull` in place, so the
// checked-out commit is the build id; APP_VERSION overrides it if the
// deploy ever stops being a git checkout, and package.json's version is
// the last resort. Resolved once at startup, not per request.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolve() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
      return `v${pkg.version}`;
    } catch {
      return 'unknown';
    }
  }
}

export const APP_VERSION = resolve();

// The human-facing release label, distinct from APP_VERSION above.
// APP_VERSION answers "exactly which build is this?" (a git SHA, for
// debugging). RELEASE_VERSION answers "which release am I on?" — the thing
// a moderator quotes and the changelog is organised by.
//
// Three tiers, each with a different bar to clear:
//   v  MAJOR . MINOR . PATCH
//       0       0       01
//   PATCH — small revisions. Ship freely.
//   MINOR — anything significant. Expects team review before release.
//   MAJOR — a major release. Always gets thorough review.
//
// package.json holds it as plain semver because npm rejects a leading zero
// ("0.0.01" is not valid semver); the two-digit patch here is purely how
// it's displayed. Bump the number in package.json — this follows.
function pkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export const SEMVER = pkgVersion() || '0.0.0';

/**
 * What the deployment calls its own release, and it has to be the string
 * somebody can clone.
 *
 * This used to pad the patch to two digits, so `0.0.2` in package.json was
 * shown as `v0.0.02` — on the lock screen, in /api/v1 and on every tester's
 * bug report. No tag has ever been named that way: the releases are `v0.0.2`
 * and `v0.0.3`. So the one number a person could check against the thing
 * they installed was the one number that never matched it, and the install
 * guide telling them to clone `v0.0.3` was contradicted by the site itself.
 *
 * It is now exactly `v` plus the version in package.json, which is the tag.
 * `scripts/selftest.js` asserts that, and asserts it against the tag the
 * install guides name, so the three cannot drift apart again.
 *
 * The `release` field under /api/v1 keeps its name and its type; api.html
 * promises those and describes the value only as "which release of the site
 * produced these", which this makes more true rather than less.
 */
export const RELEASE_VERSION = `v${SEMVER}`;
