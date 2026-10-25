/**
 * What a deployment template may contain, without a database. The pure half
 * of legacy's template rules (`validateTemplate`, `planTemplate`,
 * `describeSettings` in legacy/src/templates.js and applyTemplate.js).
 */
import { describe, expect, it } from 'vitest';
import { STARTING_POINTS } from '../../src/logbooks/templates.ts';
import {
  TEMPLATES,
  TEMPLATE_KEYS,
  describeSettings,
  planTemplate,
  templateSummaries,
} from '../../src/site/templates.ts';

const plan = (settings: object) => planTemplate({ settings });

describe('every template that ships', () => {
  it('plans cleanly, and every logbook it names is a starting point that ships', () => {
    for (const t of TEMPLATES) {
      expect(planTemplate(t), t.id).toMatchObject({ ok: true });
      if (t.settings.logbook) expect(STARTING_POINTS, t.id).toContain(t.settings.logbook);
    }
  });

  it('has a unique id the record can hold', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
  });

  it('says what it will change before anybody presses it', () => {
    for (const s of templateSummaries()) expect(s.sets.length, s.id).toBeGreaterThan(0);
  });
});

describe('what a template may not contain', () => {
  it('legal text, refused in so many words', () => {
    for (const key of ['impressum', 'privacy', 'impressum_text', 'privacy_text']) {
      expect(plan({ [key]: 'Placeholder.' })).toEqual({
        ok: false,
        error: 'A template may never write legal text.',
      });
    }
  });

  it('anything that is not already a setting, refused whole', () => {
    expect(plan({ intake: true, deployment_type: 'elections' })).toEqual({
      ok: false,
      error: 'A template cannot set: deployment_type.',
    });
    // Legacy's two that the rebuild has no setting for.
    expect(plan({ layout: 'wide' })).toMatchObject({ ok: false });
    expect(plan({ distribution: true })).toMatchObject({ ok: false });
    expect(TEMPLATE_KEYS).not.toContain('distribution');
  });

  it('a value the owning validator refuses, naming every problem at once', () => {
    const out = plan({ theme: 'no-such', intake: 'yes', copy: { nowhere: 'x' }, logbook: '../x' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/theme/);
    expect(out.error).toMatch(/intake has to be true or false/);
    expect(out.error).toMatch(/nowhere/);
    expect(out.error).toMatch(/no starting point called "\.\.\/x"/);
  });
});

describe('what a plan carries', () => {
  it('only what the template names: a key left out is left alone', () => {
    expect(plan({ intake: false })).toEqual({ ok: true, value: { copy: [], intake: false } });
  });

  it('an empty name as "back to the software’s own", and empty page text as "what ships"', () => {
    expect(plan({ siteName: '', copy: { home_intro: '' } })).toEqual({
      ok: true,
      value: { siteName: null, copy: [{ key: 'home_intro', body: null }] },
    });
  });
});

describe('describing a template', () => {
  it('tells clearing the name from leaving it alone', () => {
    expect(describeSettings({ siteName: '' })).toEqual([
      'Clears the name, back to the software’s own',
    ]);
    expect(describeSettings({})).toEqual([]);
  });

  it('describes its logbook from the file, so the count cannot go stale', () => {
    const [line] = describeSettings({ logbook: 'how-voting-went' });
    expect(line).toMatch(
      /^Makes a draft logbook, “.+”, with \d+ questions, all of them choices and no files\./,
    );
    expect(line).toMatch(/You launch it when you are ready\.$/);
  });
});
