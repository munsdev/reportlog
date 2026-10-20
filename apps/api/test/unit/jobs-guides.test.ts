/**
 * WHAT THE GUIDES SAY A LIST DOES, AND WHAT THE JOBS DO, AGREE. A person
 * reads the guide to decide whether a list is the right thing; the sweep is
 * what makes it true. If one changes alone, the guide is promising something
 * the server no longer does.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JOBS } from '../../src/jobs/registry.ts';

const guides = readFileSync(
  new URL('../../../web/src/features/site-pages/Guides.tsx', import.meta.url),
  'utf8',
).replace(/\s+/g, ' ');

describe('the guides and the sweeps', () => {
  it('the guide says what a list is and that it erases the personal half after a while', () => {
    expect(guides).toContain('A <strong>list</strong> seals nothing');
    expect(guides).toMatch(/erases the personal half of what it collects after a while/);
  });

  it('the lists sweep is described as erasing the personal half, the credential sweep as deleting', () => {
    const lists = JOBS.find((j) => j.name === 'lists-sweep');
    const credentials = JOBS.find((j) => j.name === 'sweep');
    expect(lists?.what).toMatch(/^Erase the personal half of expired list entries/);
    expect(credentials?.what).toMatch(/^Delete expired sign-in codes/);
    // Neither is described in the other's words.
    expect(credentials?.what).not.toMatch(/list/i);
    expect(lists?.what).not.toMatch(/sign-in|session/i);
  });
});
