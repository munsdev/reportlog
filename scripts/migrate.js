import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`);

const { rows: applied } = await pool.query('SELECT filename FROM schema_migrations');
const appliedSet = new Set(applied.map((r) => r.filename));

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (appliedSet.has(file)) {
    console.log(`Skipping ${file} (already applied).`);
    continue;
  }
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  console.log(`Applying ${file}...`);
  await pool.query(sql);
  await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
}

console.log('Done.');
await pool.end();
