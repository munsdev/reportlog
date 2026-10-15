/**
 * Where the transparency log is published, and the key it publishes with.
 *
 * THE PART THAT CANNOT BE PROVED HERE, said first so nothing below reads
 * as a stronger claim than it is: nothing in this container can hand the
 * generated key to a real sshd and watch it authenticate. `src/sshKey.js`
 * writes the OpenSSH key format from its specification, and the checks
 * below round-trip it against that file's own parser — which catches a
 * malformed blob and cannot catch a misreading of the spec, because it
 * would share the misreading. The one external check available is that
 * every ed25519 public key begins with the same fixed prefix, and that is
 * asserted.
 *
 * What the panel has instead is a "test" button that runs a real
 * `git ls-remote` with the key. A key OpenSSH refuses fails there, in
 * front of the operator, at the moment they set it up.
 *
 *   npm run test:db
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  settings, saveSettings, makeDeployKey, keyPath, sshCommandFor,
  reasonFor, LogRefusal, DEFAULT_TSA, pushTargets, scrubbed,
} from '../src/transparencyLog.js';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { generateDeployKey, parseDeployKey, publicKeyLine, fingerprintOfLine } from '../src/sshKey.js';

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

console.log('\nthe key format');

{
  const k = generateDeployKey('selftest@reportlog');
  /* THE ONE CHECK THAT IS NOT SELF-REFERENTIAL. Every ed25519 SSH public
     key in the world starts with these characters: they are the base64 of
     the wire-encoded string "ssh-ed25519" followed by the 32-byte key's
     length. If this ever changes, the encoding is wrong in a way no
     round-trip could show. */
  ok('the public half has the prefix every ed25519 key has',
    k.publicKey.startsWith('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI'),
    k.publicKey.slice(0, 48));
  ok('and it is one line, which is what a deploy key box takes',
    !k.publicKey.includes('\n'));
  ok('the private half is an OpenSSH key file, not a PEM of something else',
    k.privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n')
    && k.privateKey.trimEnd().endsWith('-----END OPENSSH PRIVATE KEY-----'));

  const p = parseDeployKey(k.privateKey);
  ok('it reads back as one unencrypted ed25519 key',
    p.type === 'ssh-ed25519' && p.cipher === 'none' && p.kdf === 'none' && p.keyCount === 1,
    JSON.stringify({ t: p.type, c: p.cipher, k: p.kdf, n: p.keyCount }));
  ok('the public half in the file matches the one handed to the operator',
    p.publicLine === k.publicKey);
  /* THE PRIVATE FIELD IS SEED || PUBLIC, 64 bytes. A 32-byte value here
     parses cleanly and then fails to sign, which is a failure that would
     only appear against a real host. */
  ok('the private field is the seed followed by the public key, not the seed alone',
    p.privateKey.length === 64 && p.privateKey.subarray(32).equals(p.publicKey),
    `${p.privateKey.length} bytes`);
  ok('the fingerprint is the one a host would show for that public key',
    p.fingerprint === k.fingerprint && fingerprintOfLine(k.publicKey) === k.fingerprint,
    k.fingerprint);
  ok('and it is written the way ssh-keygen and GitHub write it',
    /^SHA256:[A-Za-z0-9+/]{43}$/.test(k.fingerprint), k.fingerprint);

  // Padding is 1,2,3… and not zeroes; parseDeployKey throws on anything else.
  ok('two keys made in a row are different',
    generateDeployKey().publicKey !== generateDeployKey().publicKey);

  let threw = null;
  try { parseDeployKey('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----'); }
  catch (e) { threw = e; }
  ok('a corrupt key is refused rather than half-read', threw !== null, String(threw));

  ok('a public key line that is not ed25519 has no fingerprint',
    fingerprintOfLine('ssh-rsa AAAAB3Nza') === null);
  ok('and publicKeyLine round-trips through fingerprintOfLine',
    fingerprintOfLine(publicKeyLine(p.publicKey, 'x')) === k.fingerprint);
}

console.log('\nthe settings, which decide whether the proof leaves this box');

{
  const before = await settings();
  ok('an unconfigured deployment reports the OLD default, so upgrading changes nothing',
    before.repo_dir_is_default === true && before.repo_dir.endsWith('reportlog-transparency-log'),
    before.repo_dir);
  ok('and the shipped timestamp authority', before.tsa_url === DEFAULT_TSA);

  const saved = await saveSettings({
    remotes: [
      { name: 'origin', url: 'git@github.com:someone/log.git' },
      { name: 'mirror', url: 'https://codeberg.org/someone/log.git' },
    ],
    branch: 'main',
  });
  ok('two mirrors are kept, in order, because one host can be compelled',
    saved.remotes.length === 2 && saved.remotes[0].name === 'origin',
    JSON.stringify(saved.remotes));

  const refuse = async (patch, field) => {
    try { await saveSettings(patch); return `accepted ${JSON.stringify(patch)}`; }
    catch (e) { return e instanceof LogRefusal && e.field === field ? null : `wrong refusal: ${e.message}`; }
  };
  ok('a remote with no usable address is refused',
    await refuse({ remotes: [{ name: 'origin', url: 'not a url' }] }, 'remotes') === null);
  ok('two remotes with one name are refused, because the second would be lost',
    await refuse({ remotes: [{ name: 'a', url: 'git@h:x.git' }, { name: 'a', url: 'git@h:y.git' }] }, 'remotes') === null);
  ok('a relative checkout path is refused — a timer has no working directory to be relative to',
    await refuse({ repo_dir: 'some/where' }, 'repo_dir') === null);
  ok('a timestamp authority that is not https is refused',
    await refuse({ tsa_url: 'http://insecure.example' }, 'tsa_url') === null);
  ok('and a branch name that is not one',
    await refuse({ branch: 'has spaces' }, 'branch') === null);

  // Blank means "use the default", which is different from a bad value.
  const cleared = await saveSettings({ repo_dir: '' });
  ok('clearing the checkout path goes back to the default rather than storing empty',
    cleared.repo_dir_is_default === true, cleared.repo_dir);
}

console.log('\nthe key on disk, which is the half that must never be in a backup');

{
  const file = keyPath();
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.pub`, { force: true });

  const made = await makeDeployKey({});
  ok('making one writes the private half to disk', fs.existsSync(file));
  ok('readable by nobody but its owner',
    (fs.statSync(file).mode & 0o777) === 0o600,
    (fs.statSync(file).mode & 0o777).toString(8));
  ok('and the directory is just as closed',
    (fs.statSync(path.dirname(file)).mode & 0o777) === 0o700,
    (fs.statSync(path.dirname(file)).mode & 0o777).toString(8));
  ok('the call returns the public half and the fingerprint',
    made.publicKey.startsWith('ssh-ed25519 ') && made.fingerprint.startsWith('SHA256:'));
  /* THE WHOLE POINT OF A DEPLOY KEY OVER A STORED TOKEN. If this ever
     fails, a dump of the archive database carries write access to the
     public log, and the log's independence from this server stops being
     a fact and becomes a claim. */
  ok('THE PRIVATE HALF IS NEVER RETURNED by the call that makes it',
    !JSON.stringify(made).includes('PRIVATE KEY'),
    Object.keys(made).join(','));

  const s = await settings();
  ok('the database holds the public half and the fingerprint',
    s.deploy_public_key === made.publicKey && s.deploy_key_fingerprint === made.fingerprint);
  ok('AND NOTHING THAT LOOKS LIKE A PRIVATE KEY',
    !JSON.stringify(s).includes('PRIVATE KEY'));
  ok('and it notices the file is really there',
    s.deploy_key_present === true);

  let refused = null;
  try { await makeDeployKey({}); } catch (e) { refused = e; }
  ok('a second key is refused unless replacing is asked for',
    refused instanceof LogRefusal, String(refused));

  const replaced = await makeDeployKey({ replace: true });
  ok('and replacing works when it is asked for', replaced.publicKey !== made.publicKey);

  const cmd = sshCommandFor(file);
  ok('the ssh command names the key and only that key',
    cmd.includes('-i ' + file) && cmd.includes('IdentitiesOnly=yes'), cmd);
  /* NOT StrictHostKeyChecking=no. A push that accepts any host key can be
     pointed at another machine, and the destination being the operator's
     choice is the whole reason this key exists. */
  ok('and it does not accept any host that answers',
    !/StrictHostKeyChecking=no/.test(cmd) && /accept-new/.test(cmd), cmd);
  ok('a missing key file means no ssh command rather than a broken one',
    sshCommandFor('/nowhere/at/all') === null);

  fs.rmSync(file, { force: true });
  const gone = await settings();
  ok('a key deleted from disk is reported missing, not promised',
    gone.deploy_key_present === false && gone.deploy_public_key !== null);
}

console.log('\nwhy a push failed, which is not the same as whether it failed');

{
  // The same lesson as src/updateCheck.js and contrib/deploy.sh: the
  // generic sentence was wrong for the case that actually happens.
  const cases = [
    ['Permission denied (publickey).', /deploy key with WRITE access/i],
    ['could not read Username for \'https://github.com\'', /SSH address/i],
    ['ERROR: Repository not found.', /no repository at that address/i],
    ['ssh: Could not resolve hostname nope', /DNS/i],
    ['Connection timed out', /could not be reached/i],
    ['Host key verification failed.', /host key changed/i],
  ];
  for (const [stderr, want] of cases) {
    ok(`“${stderr.slice(0, 34)}…” is named rather than guessed at`,
      want.test(reasonFor({ stderr })), reasonFor({ stderr }));
  }
  ok('a timeout says so rather than blaming the key',
    /did not answer within/.test(reasonFor({ killed: true })));
  ok('and an unrecognised failure says it cannot name it, instead of inventing one',
    /cannot name/.test(reasonFor({ stderr: 'something nobody has seen' })));
}

console.log('\nthe push goes where the panel says, not where the checkout happens to point');

{
  /* THE GAP THIS CLOSES. The panel stored a name and a URL per mirror and
     its Test used the URL; the anchor pushed by NAME, to whatever remote of
     that name the checkout had. Nothing connected the two, so a mirror
     typed into the panel tested green and failed — or went elsewhere —
     every night. */
  await saveSettings({ remotes: [
    { name: 'origin', url: 'git@github.com:example/log.git' },
    { name: 'codeberg', url: 'git@codeberg.org:example/log.git' },
  ] });
  const s = await settings();
  const t = pushTargets({}, s);
  ok('a panel entry is pushed to by its URL',
    t.length === 2 && t[0].target === 'git@github.com:example/log.git'
      && t[1].target === 'git@codeberg.org:example/log.git', JSON.stringify(t));
  ok('and reported by its name', t.map((x) => x.name).join(',') === 'origin,codeberg');

  // The two older arrangements, unchanged, so no box moves under its operator.
  const env = pushTargets({ TRANSPARENCY_LOG_REMOTES: 'origin, backup' }, s);
  ok('TRANSPARENCY_LOG_REMOTES still wins, and still names checkout remotes',
    env.map((x) => `${x.name}=${x.target}`).join(',') === 'origin=origin,backup=backup',
    JSON.stringify(env));
  const none = pushTargets({}, { remotes: [] });
  ok('an empty panel list still pushes to the checkout\'s origin',
    none.length === 1 && none[0].target === 'origin');

  ok('a URL in git\'s own error text is replaced by the name',
    scrubbed('fatal: unable to access https://u:SECRET@h/x.git/', { name: 'm', target: 'https://u:SECRET@h/x.git' })
      === 'fatal: unable to access <m>/');

  /* AND FOR REAL, with git. A checkout whose origin points at one repository
     and a panel entry naming another: the commit must arrive at the panel's,
     and not at origin. Local bare repositories stand in for the hosts; the
     panel's own validation wants a network address, so the entry is handed
     to pushTargets directly — the part under test is where git is pointed. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'translog-push-'));
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString().trim();
  try {
    const panelRepo = path.join(tmp, 'panel.git');
    const originRepo = path.join(tmp, 'origin.git');
    const work = path.join(tmp, 'work');
    git(tmp, 'init', '-q', '--bare', panelRepo);
    git(tmp, 'init', '-q', '--bare', originRepo);
    git(tmp, 'clone', '-q', originRepo, work);
    git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'anchor');
    const head = git(work, 'rev-parse', 'HEAD');
    for (const target of pushTargets({}, { remotes: [{ name: 'origin', url: panelRepo }] })) {
      git(work, 'push', '-q', target.target, 'HEAD:main');
    }
    let atOrigin = '';
    try { atOrigin = git(originRepo, 'rev-parse', 'main'); } catch { /* no branch: nothing arrived */ }
    ok('the commit reaches the repository the panel names', git(panelRepo, 'rev-parse', 'main') === head);
    ok('and not the one the checkout\'s origin points at', atOrigin === '', atOrigin);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const anchor = fs.readFileSync(new URL('./anchor.js', import.meta.url), 'utf8');
  ok('the anchor pushes to the target and prints only the name',
    /\['push', t\.target, /.test(anchor) && /pushed to \$\{t\.name\}/.test(anchor)
      && !/console\.[a-z]+\([^\n]*t\.target/.test(anchor));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
