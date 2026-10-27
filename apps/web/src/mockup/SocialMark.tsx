/**
 * The mock-up's four social marks, drawn the way the mock-up draws them
 * (build.py SOC), plus Mastodon. The platforms the mock-up has no mark for
 * fall back to the bundled Simple Icons path (components/ui/social-icon.tsx).
 * Drawn, never fetched.
 */
import type { SocialPlatform } from '@reportlog/contracts';
import { SocialIcon } from '@/components/ui/social-icon.tsx';

export function SocialMark({ platform }: { platform: SocialPlatform }) {
  switch (platform) {
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M14 8V6.2c0-.8.5-1.2 1.2-1.2H17V2h-2.6C11.7 2 10.5 3.6 10.5 6v2H8v3h2.5v11H14V11h2.6l.4-3H14z" />
        </svg>
      );
    case 'threads':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <path d="M16.5 11.2c-.4-2.4-2-3.7-4.4-3.7-2.6 0-4.3 1.7-4.3 4.5 0 2.6 1.6 4.3 4 4.3 2.2 0 3.6-1.3 3.6-3.4 0-2.5-2.4-3.2-4.7-2.6" />
          <path d="M19.5 7.5C18.2 4.4 15.6 3 12 3 6.8 3 4 6.4 4 12s2.8 9 8 9c3.6 0 6.3-1.7 7.3-4.4" />
        </svg>
      );
    case 'bluesky':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 10.8c-1.1-2.1-4-6.1-6.8-8C2.6.9 1.6 1.2 1 1.6.3 2 0 3 0 3.6c0 .7.4 5.6.6 6.4.9 2.7 4 3.6 6.9 3.3-4.3.6-8 2.2-3.1 7.7 5.4 5.6 7.4-1.2 8.4-4.7 1 3.5 2.2 10.1 8.3 4.7 4.6-4.7 1.3-7.1-3-7.7 2.9.3 6-.6 6.9-3.3.2-.8.6-5.7.6-6.4 0-.7-.3-1.6-1-2-.6-.4-1.6-.7-4.2 1.2-2.8 1.9-5.7 5.9-6.8 8z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
        </svg>
      );
    case 'mastodon':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21.6 13.5c-.3 1.6-2.8 3.3-5.7 3.7-1.5.2-3 .3-4.5.3-2.5-.1-4.5-.6-4.5-.6v.7c.3 2.5 2.5 2.6 4.5 2.7 2.1.1 3.9-.5 3.9-.5l.1 1.9s-1.5.8-4.1.9c-1.4.1-3.2-.1-5.3-.6C1.4 20.8 1 15.9 1 11.8V8.5C1 4.3 3.7 3.1 3.7 3.1 5.1 2.5 7.4 2.2 9.8 2.2h.1c2.4 0 4.7.3 6.1.9 0 0 2.7 1.2 2.7 5.4 0 0 0 3.1-.4 5zm-2.8-4.7v5.1h-2V9c0-1.1-.5-1.6-1.4-1.6-1 0-1.5.6-1.5 1.9v2.8h-2V9.3c0-1.3-.5-1.9-1.5-1.9-.9 0-1.4.5-1.4 1.6v4.9H7V8.8c0-1.1.3-1.9.8-2.6.6-.6 1.3-.9 2.2-.9 1 0 1.8.4 2.3 1.2l.5.8.5-.8c.5-.8 1.3-1.2 2.3-1.2.9 0 1.6.3 2.2.9.6.7.9 1.5.9 2.6z" />
        </svg>
      );
    default:
      return <SocialIcon platform={platform} className="size-full" />;
  }
}
