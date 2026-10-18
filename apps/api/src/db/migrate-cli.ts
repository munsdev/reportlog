import { loadConfig } from '../config.ts';
import { migrate } from './migrate.ts';

const { DATABASE_URL } = loadConfig();
const result = await migrate(DATABASE_URL, undefined, (line) => {
  console.log(line);
});
console.log(
  result.applied.length
    ? `Applied ${result.applied.length} migration(s).`
    : 'Nothing to apply: the database is up to date.',
);
