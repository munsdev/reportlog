/**
 * Writes src/looks.gen.css from the built-in look pack: its fonts, palettes
 * and themes, with the default look's blocks also as :root.
 *
 *   pnpm --filter @reportlog/web looks:css
 *
 * Generated rather than written by hand so the stylesheet and the catalogue
 * the server offers come from one file and cannot drift. The suite fails
 * when this file is stale (test/ui/look.test.ts), the way CI fails on stale
 * database types.
 */
import { writeFileSync } from 'node:fs';
import { CORE_PACK, toCss } from '@reportlog/contracts';

const css = `${toCss(CORE_PACK, (_id, file) => `./${file}`, { root: true })}\n`;

const out = new URL('../src/looks.gen.css', import.meta.url);
writeFileSync(out, css);
console.log(`Wrote ${out.pathname}`);
