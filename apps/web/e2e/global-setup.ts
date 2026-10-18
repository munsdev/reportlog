import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** File two demo reports and leave their references for the tests. */
export default function globalSetup() {
  const api = fileURLToPath(new URL('../../api/', import.meta.url));
  const out = execFileSync('node', ['--env-file-if-exists=../../.env', 'src/dev/seed.ts'], {
    cwd: api,
    encoding: 'utf8',
  });
  const refs = out.trim().split('\n').slice(-2);
  writeFileSync(fileURLToPath(new URL('./.refs.json', import.meta.url)), JSON.stringify(refs));
}
