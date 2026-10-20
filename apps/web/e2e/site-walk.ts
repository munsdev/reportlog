/**
 * The pages the router knows, for the site shell's walks (site-ops.spec.ts).
 * Read from the route tree the router plugin generates, as the third-party
 * and accessibility walks do, so a page added tomorrow is walked without
 * anybody remembering to.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const refs = JSON.parse(
  readFileSync(fileURLToPath(new URL('./.refs.json', import.meta.url)), 'utf8'),
) as string[];

export function everyPage(): string[] {
  const tree = readFileSync(
    fileURLToPath(new URL('../src/routeTree.gen.ts', import.meta.url)),
    'utf8',
  );
  const block = /fullPaths:\s*((?:\|\s*'[^']*'\s*)+)/.exec(tree)?.[1] ?? '';
  return [...block.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
}

const PARAMS: Record<string, string> = {
  slug: 'demo',
  ref: refs[0] ?? 'RL-NONE',
  token: 'a-token-that-names-nothing',
  threadId: '00000000-0000-4000-8000-000000000000',
  id: '1',
};

export function address(path: string): string {
  return path.replace(/\$(\w+)/g, (_m, name: string) => {
    const value = PARAMS[name];
    if (value === undefined) throw new Error(`${path}: give $${name} a value in PARAMS`);
    return value;
  });
}
