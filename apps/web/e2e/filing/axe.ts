/**
 * The accessibility check, for a page as it is NOW: the filing form is one
 * address and many cards, so the page walk (e2e/accessibility.spec.ts) sees
 * only its opening card. The filing tests call this on every card.
 *
 * Q3's checker, as that walk runs it: axe-core from node_modules, evaluated
 * in the page as a string and never fetched, so the check asks no third
 * party for anything; WCAG 2.0, 2.1 and 2.2 at A and AA. There is no list of
 * allowances here: a card that fails, fails.
 *
 * Kept beside the filing tests rather than imported from the walk, because
 * a spec file registers its tests in whatever imports it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { AxeResults, Result, RunOptions } from 'axe-core';

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

interface Axe {
  run(context: Document, options: RunOptions): Promise<AxeResults>;
}

function describe(v: Result): string {
  const where = v.nodes
    .slice(0, 5)
    .map(
      (n) =>
        `    ${n.target.join(' ')}\n      ${n.failureSummary?.replace(/\n/g, '\n      ') ?? ''}`,
    )
    .join('\n');
  return `${v.id} (${v.impact ?? 'no impact given'}): ${v.help}\n  ${v.helpUrl}\n${where}`;
}

/** Fails the test, naming each rule and element, if this card breaks one. */
export async function expectAccessible(page: Page, what: string): Promise<void> {
  // Once per page: the source stays defined across cards, which are not loads.
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE_SOURCE);
  const { violations } = await page.evaluate(
    (tags) =>
      (window as unknown as { axe: Axe }).axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
      }),
    TAGS,
  );
  expect(violations.map(describe).join('\n\n'), what).toBe('');
}
