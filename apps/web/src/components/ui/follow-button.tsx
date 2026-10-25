/**
 * A small "Follow us" button in a corner of the public pages an administrator
 * chose (Site → Social media), opening the accounts that are switched on.
 *
 * NEVER ON A FORM OR A DOOR, and that is not a setting. A page carries it
 * only if `socialFloatPageOf` names it (the front page, board, maps, about,
 * journalists), so a filing form, a list form and the rest are out by
 * construction; a door is also checked by name. One card asks one question,
 * and nothing in front of somebody filling a form may change underneath them.
 *
 * QUIET ON A DOOR AND ON THE LOCK SCREEN. It asks for the site only when the
 * page is past the password, on a page that may carry it: the same rule as
 * the development badge, so it can never close a door by asking something the
 * door may not.
 *
 * It opens on a press and never by itself. It sits in the bottom-right corner
 * above the development badge's place (and above the Save bar and the bottom
 * bar like it), because the bottom-left is the front page's "Edit this page".
 */
import { socialFloatPageOf } from '@reportlog/contracts';
import type { PublicSocialLink } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { siteStatusQuery, useGateMode } from '@/features/identity/gateMode.ts';
import { siteQuery } from './site.tsx';
import { SocialLinks } from './social-links.tsx';

export function FollowButton() {
  const onDoor = useGateMode() === 'door';
  const { pathname } = useLocation();
  const page = socialFloatPageOf(pathname);
  const status = useQuery(siteStatusQuery);
  const past = status.data !== undefined && !status.data.locked && !onDoor;
  const site = useQuery({ ...siteQuery, enabled: past && page !== null });
  const links = site.data?.social_links;
  if (onDoor || page === null || !links?.length) return null;
  if (!site.data?.social_float_pages?.includes(page)) return null;
  return <Menu links={links} siteName={site.data.plain_name} />;
}

function Menu({ links, siteName }: { links: readonly PublicSocialLink[]; siteName: string }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      ref={root}
      data-follow-us
      className="fixed right-4 bottom-[calc(max(var(--rl-savebar-height,0px),var(--rl-bottom-bar-height,0px))+4.5rem)] z-30 flex flex-col items-end gap-2 print:hidden"
    >
      {open ? (
        <div
          id={panel}
          role="group"
          aria-label="Follow us"
          className="rounded-card border border-line bg-surface p-3 shadow-raised"
        >
          <SocialLinks links={links} siteName={siteName} variant="list" />
        </div>
      ) : null}
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        className="min-h-11 rounded-control border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-raised"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        Follow us
      </button>
    </div>
  );
}
