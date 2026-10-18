import { describe, expect, it } from 'vitest';
import { capturingMailer, stderrMailer } from '../../src/email/mailer.ts';
import { HttpError } from '../../src/http/errors.ts';
import { limiter } from '../../src/identity/limiter.ts';
import { mayInvite } from '../../src/identity/invitations.ts';
import { subjects } from '../../src/identity/otp.ts';
import {
  hashPassword,
  looksLikeEmail,
  normalizeEmail,
  randomCode,
  sameHex,
  verifyPassword,
} from '../../src/identity/secrets.ts';
import { validateCurtainPassword } from '../../src/identity/siteAccess.ts';

describe('addresses', () => {
  it('normalizes to one spelling and refuses what is plainly not an address', () => {
    expect(normalizeEmail('  Ada@Example.ORG ')).toBe('ada@example.org');
    expect(normalizeEmail(42)).toBe('');
    expect(looksLikeEmail('ada@example.org')).toBe(true);
    for (const bad of [
      '',
      'ada',
      'ada@',
      'ada@example',
      'a b@example.org',
      '<a>@example.org',
      'a@b@c.org',
    ]) {
      expect(looksLikeEmail(bad), bad).toBe(false);
    }
  });
});

describe('one-time codes', () => {
  it('are six digits, leading zeros kept', () => {
    for (let i = 0; i < 50; i += 1) expect(randomCode()).toMatch(/^\d{6}$/);
  });

  it('bind a handover to both addresses, normalized, and keep purposes apart', () => {
    expect(subjects.handover('A@x.org', ' b@x.org')).toBe(subjects.handover('a@x.org', 'B@X.ORG'));
    expect(subjects.handover('a@x.org', 'b@x.org')).not.toBe(
      subjects.handover('a@x.org', 'c@x.org'),
    );
    expect(subjects.signIn('a@x.org')).not.toBe(subjects.setup('a@x.org'));
  });
});

describe('the site password', () => {
  it('is stored salted, so the same password hashes differently twice, and still verifies', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('wrong horse', a)).toBe(false);
  });

  it('admits nobody when none was ever set', async () => {
    expect(await verifyPassword('', null)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('has a floor, not a policy, and must be confirmed', () => {
    expect(validateCurtainPassword('', '')).toMatchObject({ ok: false });
    expect(validateCurtainPassword('        ', '        ')).toMatchObject({ ok: false });
    expect(validateCurtainPassword('seven77', 'seven77')).toMatchObject({ ok: false });
    expect(validateCurtainPassword('eight888', 'eight889')).toEqual({
      ok: false,
      message: 'The two passwords do not match.',
    });
    expect(validateCurtainPassword('eight888', 'eight888')).toEqual({
      ok: true,
      password: 'eight888',
    });
  });
});

describe('the invitation ceiling', () => {
  it('lets nobody hand out a system role, and holds a manager making a manager', () => {
    for (const role of ['moderator', 'access_manager', 'admin', 'owner', 'user', '']) {
      expect(mayInvite({ actorIsManager: true, role })).toEqual({
        ok: false,
        reason: 'unknown-role',
      });
      expect(mayInvite({ actorIsManager: false, role })).toEqual({
        ok: false,
        reason: 'unknown-role',
      });
    }
    expect(mayInvite({ actorIsManager: true, role: 'coordinator' })).toEqual({
      ok: true,
      role: 'coordinator',
      requiresApproval: false,
    });
    expect(mayInvite({ actorIsManager: true, role: 'manager' })).toMatchObject({
      requiresApproval: true,
    });
    expect(mayInvite({ actorIsManager: false, role: 'manager' })).toMatchObject({
      requiresApproval: false,
    });
  });
});

describe('the limiter', () => {
  it('lets the first few through and then answers with a sentence', () => {
    const l = limiter({ max: 2, windowMs: 60_000 });
    l.take('k');
    l.take('k');
    expect(() => {
      l.take('k');
    }).toThrow(HttpError);
    // Another key has its own window.
    expect(() => {
      l.take('other');
    }).not.toThrow();
  });
});

describe('the mailers', () => {
  it('keeps what it was given, findable by address', async () => {
    const m = capturingMailer();
    await m.send({ to: 'a@x.org', subject: 'one', text: 'first' });
    await m.send({ to: 'a@x.org', subject: 'two', text: 'second' });
    expect(m.messages).toHaveLength(2);
    expect(m.lastTo(' A@X.org')?.subject).toBe('two');
    expect(m.lastTo('b@x.org')).toBeUndefined();
  });

  it('says plainly when nothing was sent', async () => {
    const lines: string[] = [];
    await stderrMailer((l) => void lines.push(l)).send({ to: 'a@x.org', subject: 's', text: 't' });
    expect(lines.join('')).toContain('No email provider is configured');
  });

  it('compares digests in constant time and refuses empty ones', () => {
    expect(sameHex('ab', 'ab')).toBe(true);
    expect(sameHex('ab', 'ac')).toBe(false);
    expect(sameHex('', '')).toBe(false);
  });
});
