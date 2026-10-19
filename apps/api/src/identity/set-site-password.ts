/**
 * Set the site password from the server, for the person installing.
 *
 *   node src/identity/set-site-password.ts            (asks for it twice)
 *   SITE_PASSWORD=... node src/identity/set-site-password.ts
 *
 * The setup wizard is behind this password and refuses to run without one,
 * so a stranger who finds a fresh install cannot seat themselves as its
 * owner. The wizard then makes the new owner decide whether to keep it.
 *
 * Also the way back in for an operator who has lost it. Every existing
 * site-access cookie stops working.
 */
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/database.ts';
import { validateCurtainPassword, writeSiteAccess } from './siteAccess.ts';

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

const fromEnv = process.env.SITE_PASSWORD;
const password = fromEnv ?? (await ask('New site password: '));
const confirm = fromEnv ?? (await ask('The same password again: '));
const check = validateCurtainPassword(password, confirm);
if (!check.ok) {
  process.stderr.write(`${check.message}\n`);
  process.exit(1);
}

const db = createDatabase(loadConfig().DATABASE_URL, 2);
try {
  await writeSiteAccess(db, { password: check.password });
  process.stderr.write(
    'The site password is set and on. Everybody who had the old one is signed out of it.\n',
  );
} finally {
  await db.destroy();
}
