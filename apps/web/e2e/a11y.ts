/**
 * The accessibility check (decision 12), shared by the walk of every page
 * (accessibility.spec.ts) and the lock screen's own pass with the password
 * on (a11y-locked/). axe-core, from node_modules, is evaluated inside the
 * page as a string, never fetched, so the check asks no third party for
 * anything and works under the site's CSP, which allows no inline script.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import type { AxeResults, Result, RunOptions } from 'axe-core';

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

/** WCAG 2.0, 2.1 and 2.2, levels A and AA. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

/** The part of axe the page has once its source is evaluated. */
interface Axe {
  run(context: Document, options: RunOptions): Promise<AxeResults>;
}

export async function axe(page: Page): Promise<AxeResults> {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(
    (tags) =>
      (window as unknown as { axe: Axe }).axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
      }),
    TAGS,
  );
}

/** A violation in words: the rule, axe's help, and the first few elements. */
export function describeViolation(v: Result): string {
  const where = v.nodes
    .slice(0, 5)
    .map(
      (n) =>
        `    ${n.target.join(' ')}\n      ${n.failureSummary?.replace(/\n/g, '\n      ') ?? ''}`,
    )
    .join('\n');
  return `${v.id} (${v.impact ?? 'no impact given'}): ${v.help}\n  ${v.helpUrl}\n${where}`;
}
