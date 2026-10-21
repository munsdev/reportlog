import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** File two demo reports and leave their references for the tests. */
export default function globalSetup() {
  const api = fileURLToPath(new URL('../../api/', import.meta.url));
  // Migrate first. A database a migration behind fails screens in ways that
  // look like bugs in them; CI always starts fresh and never sees this.
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/db/migrate-cli.ts'], { cwd: api });
  const out = execFileSync('node', ['--env-file-if-exists=../../.env', 'src/dev/seed.ts'], {
    cwd: api,
    encoding: 'utf8',
  });
  const refs = out.trim().split('\n').slice(-2);
  // Setup finished and the password off, so the setup wizard does not stand
  // in front of every page. The identity tests set up their own state.
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/identity/dev-state.ts', 'set-up'], {
    cwd: api,
  });
  // The door's minimum time on a form off: a script fills a one-card form in
  // faster than a person. The minimum is tested in test/db/door.test.ts.
  execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/door/dev-state.ts', 'min-form', '0'],
    {
      cwd: api,
    },
  );
  rmSync(fileURLToPath(new URL('./.outbox/', import.meta.url)), { recursive: true, force: true });
  writeFileSync(fileURLToPath(new URL('./.refs.json', import.meta.url)), JSON.stringify(refs));
}
