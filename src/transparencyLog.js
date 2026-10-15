/**
 * Where the daily anchor goes, and the key it goes with.
 *
 * The anchor is the archive's claim that it has not been quietly altered:
 * every logbook's chain head, timestamped by an authority that is not this
 * server, published somewhere this server does not control. Until migration
 * 052 the destination lived in three environment variables, which is a
 * configuration story for an operator with a shell and no story at all for
 * anybody else.
 *
 * THE PRIVATE KEY IS NEVER IN THE DATABASE. It is a file, mode 0600, owned
 * by the service user. A database dump must not carry write access to the
 * public log — if it did, the log's independence from this server would be
 * a claim rather than a fact. The panel shows the public half and the
 * fingerprint; the private half is written once and read only by git.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pool } from './db.js';
import { generateDeployKey, fingerprintOfLine } from './sshKey.js';

const run = promisify(execFile);

export class LogRefusal extends Error {
  constructor(field, message) { super(message); this.field = field; }
}

/** The old default, kept exactly so an unconfigured box does not change. */
export function defaultRepoDir(env = process.env) {
  return env.TRANSPARENCY_LOG_DIR || path.join(os.homedir(), 'reportlog-transparency-log');
}

export const DEFAULT_TSA = 'https://zeitstempel.dfn.de';

/**
 * WHERE THE PRIVATE KEY LIVES.
 *
 * Under the checkout's `var/`, which reportlog.service already grants
 * write access to and which nothing serves. NOT under `.ssh/` in a home
 * directory: the home directory of whichever account runs the timer is
 * not something this code should be asserting, which is the same reason
 * the repo directory is configurable.
 */
export function keyPath(env = process.env) {
  const base = env.REPORTLOG_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  return path.join(base, 'var', 'transparency-log', 'deploy_key');
}

const SSH_OPTS_NOTE = 'IdentitiesOnly=yes stops ssh offering every key the account '
  + 'happens to have before this one, which on a box with other keys is an '
  + 'authentication failure that names the wrong cause.';

/**
 * The GIT_SSH_COMMAND a push needs, or null when no key has been made.
 *
 * StrictHostKeyChecking is NOT disabled. A push that accepts any host key
 * is a push that can be pointed at another machine, and the whole reason
 * this key exists is that the destination must be the one the operator
 * chose. `accept-new` records the host the first time and refuses a change
 * after that, which is the behaviour an unattended timer needs: it cannot
 * answer a prompt, and it must not be silently redirected.
 */
export function sshCommandFor(file, env = process.env) {
  if (!file || !fs.existsSync(file)) return null;
  const known = path.join(path.dirname(file), 'known_hosts');
  return `ssh -i ${file} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`
    + ` -o UserKnownHostsFile=${known}`;
}

export async function settings(client = pool) {
  let row = null;
  try {
    const { rows } = await client.query('SELECT * FROM transparency_log_settings WHERE id = true');
    row = rows[0] || null;
  } catch (e) {
    /* FORGIVES EXACTLY ONE MISSING THING. A catch wide enough to mean
       "something is absent" cannot tell a box part-way through an upgrade
       from a query that was wrong when it was written, and it reports the
       reassuring one. */
    if (e.code !== '42P01') throw e;
  }
  const r = row || {};
  return {
    configured: !!row,
    repo_dir: r.repo_dir || defaultRepoDir(),
    repo_dir_is_default: !r.repo_dir,
    branch: r.branch || 'main',
    remotes: Array.isArray(r.remotes) ? r.remotes : [],
    tsa_url: r.tsa_url || DEFAULT_TSA,
    deploy_public_key: r.deploy_public_key || null,
    deploy_key_fingerprint: r.deploy_key_fingerprint || null,
    deploy_key_made_at: r.deploy_key_made_at || null,
    // Read from disk, because the row can say a key exists after somebody
    // has deleted the file and the panel must not promise one that is gone.
    deploy_key_present: fs.existsSync(keyPath()),
    last_push_at: r.last_push_at || null,
    last_push_ok: r.last_push_ok,
    last_push_detail: r.last_push_detail || null,
  };
}

const URL_OK = /^(https:\/\/|git@|ssh:\/\/)[^\s]+$/;
const NAME_OK = /^[a-z0-9][a-z0-9._-]{0,38}$/i;

/** Only what is named is changed. */
export async function saveSettings(patch = {}, client = pool) {
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  const set = []; const vals = [];
  const put = (col, v) => { vals.push(v); set.push(`${col} = $${vals.length}`); };

  if (has('repo_dir')) {
    const d = String(patch.repo_dir || '').trim();
    if (d && !path.isAbsolute(d)) {
      throw new LogRefusal('repo_dir', 'The checkout needs an absolute path.');
    }
    put('repo_dir', d || null);
  }
  if (has('branch')) {
    const b = String(patch.branch || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,100}$/.test(b)) {
      throw new LogRefusal('branch', 'That is not a branch name.');
    }
    put('branch', b);
  }
  if (has('tsa_url')) {
    const t = String(patch.tsa_url || '').trim();
    if (t && !/^https:\/\/[^\s]+$/.test(t)) {
      throw new LogRefusal('tsa_url', 'The timestamp authority needs to be an https address.');
    }
    put('tsa_url', t || null);
  }
  if (has('remotes')) {
    const list = Array.isArray(patch.remotes) ? patch.remotes : [];
    const seen = new Set();
    const clean = [];
    for (const r of list) {
      const name = String(r?.name || '').trim();
      const url = String(r?.url || '').trim();
      if (!name && !url) continue;
      if (!NAME_OK.test(name)) {
        throw new LogRefusal('remotes', `“${name || '(blank)'}” is not a usable remote name.`);
      }
      if (!URL_OK.test(url)) {
        throw new LogRefusal('remotes',
          `“${url || '(blank)'}” is not a git address. It starts with https://, git@ or ssh://.`);
      }
      if (seen.has(name)) throw new LogRefusal('remotes', `Two remotes are both called “${name}”.`);
      seen.add(name);
      clean.push({ name, url });
    }
    put('remotes', JSON.stringify(clean));
  }
  if (!set.length) return settings(client);
  vals.push(new Date());
  set.push(`updated_at = $${vals.length}`);
  await client.query(`UPDATE transparency_log_settings SET ${set.join(', ')} WHERE id = true`, vals);
  return settings(client);
}

/**
 * Make a deploy key. Refuses to overwrite one that exists unless asked,
 * because replacing it silently would break the push until somebody
 * noticed and pasted the new public half into every host.
 */
export async function makeDeployKey({ replace = false } = {}, client = pool) {
  const file = keyPath();
  if (fs.existsSync(file) && !replace) {
    throw new LogRefusal('key',
      'There is already a key. Replacing it stops every push working until you '
      + 'put the new public half on each host, so it has to be asked for.');
  }
  const key = generateDeployKey('reportlog-transparency-log');

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  /* WRITTEN WITH THE MODE IN THE OPEN, not chmod'ed afterwards. Between a
     create and a chmod there is an instant where the private key is
     readable by anybody on the box, and a timer-driven file nobody is
     watching is exactly where that is never noticed. */
  fs.writeFileSync(file, key.privateKey, { mode: 0o600 });
  fs.writeFileSync(`${file}.pub`, `${key.publicKey}\n`, { mode: 0o644 });

  await client.query(
    `UPDATE transparency_log_settings
        SET deploy_public_key = $1, deploy_key_fingerprint = $2,
            deploy_key_made_at = now(), updated_at = now()
      WHERE id = true`,
    [key.publicKey, key.fingerprint],
  );
  // THE PRIVATE HALF IS NOT RETURNED. Nothing upstream of here has a use
  // for it, and a value that is never returned cannot be logged by accident.
  return { publicKey: key.publicKey, fingerprint: key.fingerprint, path: file };
}

/**
 * Does the key actually open the door?
 *
 * A REAL `git ls-remote`, not a guess. The key format in src/sshKey.js is
 * written from the specification and round-tripped against its own parser,
 * which cannot catch a misreading of the specification — only a real host
 * can. So this is the check that matters, and it is in front of the
 * operator at the moment they set it up rather than at 3am in a cron mail.
 *
 * Read-only: ls-remote writes nothing, so a test cannot damage the log.
 */
export async function testRemote(name, client = pool) {
  const s = await settings(client);
  const remote = s.remotes.find((r) => r.name === name);
  if (!remote) throw new LogRefusal('remotes', 'There is no remote by that name.');

  const sshCommand = sshCommandFor(keyPath());
  const env = { ...process.env };
  if (sshCommand) env.GIT_SSH_COMMAND = sshCommand;
  // Never block on a credential prompt: a timer has nobody to answer it,
  // and a hung test is worse than a failed one.
  env.GIT_TERMINAL_PROMPT = '0';

  try {
    const { stdout } = await run('git', ['ls-remote', '--heads', remote.url], {
      env, timeout: 20000, maxBuffer: 1 << 20,
    });
    const heads = stdout.trim().split('\n').filter(Boolean)
      .map((l) => l.split(/\s+/)[1]).filter(Boolean);
    return {
      ok: true,
      name,
      branches: heads.map((h) => h.replace('refs/heads/', '')),
      hasBranch: heads.some((h) => h === `refs/heads/${s.branch}`),
      usedKey: !!sshCommand,
    };
  } catch (e) {
    return { ok: false, name, reason: reasonFor(e), usedKey: !!sshCommand };
  }
}

/**
 * WHY IT FAILED, IN WORDS WRITTEN HERE.
 *
 * The same lesson as src/updateCheck.js and contrib/deploy.sh: "could not
 * reach it" is a guess, and it is wrong for the case that actually happens
 * — a key the host has not been given yet. Fixed strings, because git's
 * error text can carry the remote URL and a URL can carry a token.
 */
export function reasonFor(e) {
  const text = `${e?.stderr || ''} ${e?.message || ''}`.toLowerCase();
  if (e?.killed) return 'The host did not answer within 20 seconds.';
  if (/permission denied \(publickey\)|could not read from remote repository/.test(text)) {
    return 'The host refused the key. Add the public half below to the repository as a '
      + 'deploy key with WRITE access — read-only is enough to test and not enough to publish.';
  }
  if (/could not read username|terminal prompts disabled|authentication failed|invalid username/.test(text)) {
    return 'The host wanted a username and password. Use an SSH address (git@…) so the '
      + 'deploy key is what answers, rather than an https one.';
  }
  if (/repository not found|does not appear to be a git repository|not found/.test(text)) {
    return 'There is no repository at that address, or the key cannot see it. On a private '
      + 'repository those are the same message on purpose.';
  }
  if (/could not resolve host|name or service not known/.test(text)) {
    return 'That hostname does not resolve. This is DNS on this box rather than the repository.';
  }
  if (/connection refused|connection timed out|network is unreachable/.test(text)) {
    return 'The host could not be reached at all.';
  }
  if (/host key verification failed/.test(text)) {
    return 'The host key changed since this deployment first saw it. That is either the host '
      + 'being rebuilt or traffic being intercepted, and it is not something to click past.';
  }
  return 'The push test failed for a reason this cannot name. The anchor log has git’s own words.';
}

/**
 * WHERE THE NIGHTLY PUSH GOES, worked out once, here, from the same settings
 * the panel shows and tests.
 *
 * IT USED TO PUSH BY NAME. The panel stored a name AND a URL for each mirror,
 * its Test button tried the URL — and the anchor pushed to whatever remote
 * of that name the checkout happened to have. Nothing ever wrote the panel's
 * URL into the checkout. So a mirror typed into the panel tested green and
 * then failed every night, or worse, went somewhere else: the panel said one
 * destination and the archive's proof went to another.
 *
 * Now the panel's list is the destination, URL and all, so what Test proves
 * is what the push does. Two older arrangements are kept exactly, so no box
 * changes under its operator:
 *   - TRANSPARENCY_LOG_REMOTES in .env still wins, and still names remotes
 *     in the checkout — that is what it always meant;
 *   - an empty panel list still pushes to the checkout's `origin`, which is
 *     what a fresh clone has.
 *
 * Returns [{ name, target }]: `name` is what is printed and recorded,
 * `target` is what git is handed. They differ only for a panel entry, and
 * only `name` is ever logged, because a URL can carry a token.
 */
export function pushTargets(env = process.env, cfg = {}) {
  if (env.TRANSPARENCY_LOG_REMOTES) {
    return env.TRANSPARENCY_LOG_REMOTES.split(',').map((r) => r.trim()).filter(Boolean)
      .map((name) => ({ name, target: name }));
  }
  const listed = Array.isArray(cfg.remotes) ? cfg.remotes.filter((r) => r && r.name && r.url) : [];
  if (listed.length) return listed.map((r) => ({ name: r.name, target: r.url }));
  return [{ name: 'origin', target: 'origin' }];
}

/** Git's own error text with the address replaced by its name. */
export function scrubbed(text, { name, target }) {
  const s = String(text || '').trim();
  return target && target !== name ? s.split(target).join(`<${name}>`) : s;
}

/** Written by the anchor so the panel can say what happened, not guess. */
export async function recordPush({ ok, detail }, client = pool) {
  await client.query(
    `UPDATE transparency_log_settings
        SET last_push_at = now(), last_push_ok = $1, last_push_detail = $2
      WHERE id = true`,
    [!!ok, detail ? String(detail).slice(0, 2000) : null],
  );
}

export { fingerprintOfLine, SSH_OPTS_NOTE };
