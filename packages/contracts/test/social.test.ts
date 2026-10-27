/**
 * The site's social media addresses: what a typed handle or link stands
 * for, what is refused (matched by the sentence an administrator reads), and
 * how a stored list is made whole.
 */
import { describe, expect, it } from 'vitest';
import {
  SOCIAL_PLATFORMS,
  SOCIAL_RULES,
  resolveSocialFloat,
  placementOn,
  resolveSocialLinks,
  resolveSocialPlacements,
  SOCIAL_PLACEMENTS,
  shownSocialLinks,
  socialFloatPageOf,
  socialAddress,
} from '../src/index.ts';
import type { SocialPlatform } from '../src/index.ts';

const url = (p: SocialPlatform, raw: string) => {
  const r = socialAddress(p, raw);
  if (!r.ok) throw new Error(r.error);
  return r.url;
};
const refusal = (p: SocialPlatform, raw: string) => {
  const r = socialAddress(p, raw);
  if (r.ok) throw new Error(`accepted ${raw} as ${String(r.url)}`);
  return r.error;
};

describe('socialAddress', () => {
  it('reads a handle as the account it names, on every platform that has handles', () => {
    expect(url('facebook', 'ourpage')).toBe('https://www.facebook.com/ourpage');
    expect(url('instagram', '@our.name')).toBe('https://www.instagram.com/our.name');
    expect(url('threads', '@ourname')).toBe('https://www.threads.com/@ourname');
    expect(url('bluesky', '@ours.bsky.social')).toBe('https://bsky.app/profile/ours.bsky.social');
    expect(url('tiktok', 'ourname')).toBe('https://www.tiktok.com/@ourname');
    expect(url('youtube', '@ourchannel')).toBe('https://www.youtube.com/@ourchannel');
    expect(url('x', '@ourname')).toBe('https://x.com/ourname');
    expect(url('telegram', 'ourchannel')).toBe('https://t.me/ourchannel');
    expect(url('mastodon', '@ours@mastodon.social')).toBe('https://mastodon.social/@ours');
  });

  it('takes a link with or without https://, and upgrades http', () => {
    expect(url('youtube', 'https://www.youtube.com/channel/UC123')).toBe(
      'https://www.youtube.com/channel/UC123',
    );
    expect(url('bluesky', 'bsky.app/profile/ours.org')).toBe('https://bsky.app/profile/ours.org');
    expect(url('facebook', 'http://facebook.com/ourpage')).toBe('https://facebook.com/ourpage');
    expect(url('threads', 'https://www.threads.net/@ours')).toBe('https://www.threads.net/@ours');
    expect(url('whatsapp', 'https://whatsapp.com/channel/0029Va')).toBe(
      'https://whatsapp.com/channel/0029Va',
    );
    expect(url('mastodon', 'https://social.example.org/@ours')).toBe(
      'https://social.example.org/@ours',
    );
  });

  it('is nothing when nothing is typed', () => {
    expect(url('instagram', '   ')).toBeNull();
  });

  it('refuses an address on another site, naming the platform', () => {
    expect(refusal('instagram', 'https://evil.example/instagram.com')).toContain(
      'not on Instagram',
    );
    // A look-alike host is not a subdomain.
    expect(refusal('facebook', 'https://notfacebook.com/ourpage')).toContain('not on Facebook');
  });

  it('refuses what is not a web address, a platform’s front page, and credentials', () => {
    expect(refusal('x', 'javascript:alert(1)')).toContain('https://');
    expect(refusal('tiktok', 'https://www.tiktok.com/')).toContain('your own TikTok account');
    expect(refusal('youtube', 'https://me:pw@youtube.com/@x')).toContain('password');
    expect(refusal('whatsapp', '@ours')).toContain('not on WhatsApp');
    expect(refusal('mastodon', 'ours')).toContain('not an address');
    expect(refusal('instagram', `@${'a'.repeat(400)}`)).toContain('under 300');
  });

  it('has a rule, a name and an example for every platform', () => {
    for (const p of SOCIAL_PLATFORMS) {
      expect(SOCIAL_RULES[p].name).not.toBe('');
      expect(SOCIAL_RULES[p].example).not.toBe('');
    }
  });
});

describe('resolveSocialLinks', () => {
  it('is every platform, off, when nothing is stored or what is stored is not a list', () => {
    for (const stored of [null, undefined, {}, 'x']) {
      const links = resolveSocialLinks(stored);
      expect(links.map((l) => l.id)).toEqual([...SOCIAL_PLATFORMS]);
      expect(links.every((l) => !l.shown && l.url === null)).toBe(true);
    }
  });

  it('keeps the shipped order, drops what it cannot read, and never shows an empty address', () => {
    const links = resolveSocialLinks([
      { id: 'youtube', url: 'https://www.youtube.com/@a', shown: true },
      { id: 'myspace', url: 'https://myspace.com/a', shown: true },
      { id: 'youtube', url: 'https://www.youtube.com/@b', shown: false },
      { id: 'facebook', url: null, shown: true },
      { id: 'tiktok', url: 'https://www.tiktok.com/@a', shown: false },
      { id: 'x', url: 'javascript:alert(1)', shown: true },
    ]);
    expect(links.find((l) => l.id === 'x')).toEqual({ id: 'x', url: null, shown: false });
    expect(links[0]).toEqual({ id: 'facebook', url: null, shown: false });
    expect(links.find((l) => l.id === 'youtube')).toEqual({
      id: 'youtube',
      url: 'https://www.youtube.com/@a',
      shown: true,
    });
    expect(shownSocialLinks(links)).toEqual([{ id: 'youtube', url: 'https://www.youtube.com/@a' }]);
  });
});

describe('the floating Follow us button', () => {
  it('is off, on every page, when nothing is stored', () => {
    for (const stored of [null, undefined, 'x', []]) {
      expect(resolveSocialFloat(stored)).toEqual({
        on: false,
        pages: ['front', 'board', 'maps', 'about', 'journalists'],
      });
    }
  });

  it('keeps only pages it can place, once, in the shipped order', () => {
    expect(resolveSocialFloat({ on: true, pages: ['about', 'file', 'front', 'about'] })).toEqual({
      on: true,
      pages: ['front', 'about'],
    });
    expect(resolveSocialFloat({ on: 'yes', pages: [] })).toEqual({ on: false, pages: [] });
  });

  it('names the five pages, and no form, list, door or staff screen', () => {
    expect(socialFloatPageOf('/')).toBe('front');
    expect(socialFloatPageOf('/board')).toBe('board');
    expect(socialFloatPageOf('/board/some-report')).toBe('board');
    expect(socialFloatPageOf('/map')).toBe('maps');
    expect(socialFloatPageOf('/map/heat')).toBe('maps');
    expect(socialFloatPageOf('/about')).toBe('about');
    expect(socialFloatPageOf('/journalists')).toBe('journalists');
    for (const path of [
      '/file/elections',
      '/submit',
      '/list/contact',
      '/journalists/access',
      '/journalists/alerts',
      '/evidence/abc',
      '/home',
      '/settings/social',
      '/boardroom',
      '/mapping',
    ]) {
      expect(socialFloatPageOf(path), path).toBeNull();
    }
  });
});

describe('where the accounts show', () => {
  it('is every placement until somebody chooses, and then only the ones named, in the shipped order', () => {
    expect(resolveSocialPlacements(null)).toEqual([...SOCIAL_PLACEMENTS]);
    expect(resolveSocialPlacements('nonsense')).toEqual([...SOCIAL_PLACEMENTS]);
    expect(resolveSocialPlacements({ on: ['footer', 'front', 'footer', 'a form'] })).toEqual([
      'front',
      'footer',
    ]);
    expect(resolveSocialPlacements({ on: [] })).toEqual([]);
  });

  it('is exactly these eight, none of them a form or a door: a new one is a decision', () => {
    expect([...SOCIAL_PLACEMENTS]).toEqual([
      'front',
      'get_involved',
      'after_filing',
      'after_tip',
      'journalists',
      'menu',
      'ticker',
      'footer',
    ]);
  });

  it('reads an answer with no list as every placement on, and an empty one as none', () => {
    expect(placementOn(undefined, 'menu')).toBe(true);
    expect(placementOn([], 'menu')).toBe(false);
    expect(placementOn(['menu'], 'menu')).toBe(true);
    expect(placementOn(['menu'], 'footer')).toBe(false);
  });
});
