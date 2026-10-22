/**
 * "Under active development", in the corner of every page while the notice
 * is on. A deploy turns it on for a few hours by itself; an administrator
 * can turn it on or off in Settings.
 *
 * The server sends when it ENDS, not whether it is on, so the badge takes
 * itself down at that moment without asking again.
 *
 * Neutral colours: it is a notice, not a warning, and a status colour on a
 * button would be saying something about a report.
 *
 * It never covers the Save bar: it sits above the height the bar publishes
 * (`--rl-savebar-height`, save-bar.tsx), which is 0 while there is none.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { siteStatusQuery, useGateMode } from '@/features/identity/gateMode.ts';
import { siteQuery } from './site.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog.tsx';

/** setTimeout cannot wait longer than this; a longer window is re-checked on the next load. */
const LONGEST_TIMER = 2_147_483_647;

export function useDevModeActive(until: string | null | undefined, now = Date.now): boolean {
  const [, tick] = useState(0);
  const remaining = until ? new Date(until).getTime() - now() : 0;
  useEffect(() => {
    if (remaining <= 0 || remaining >= LONGEST_TIMER) return;
    const t = setTimeout(() => {
      tick((n) => n + 1);
    }, remaining);
    return () => {
      clearTimeout(t);
    };
  }, [remaining]);
  return remaining > 0;
}

/**
 * Past the password the site's settings say (and stay fresh); on the lock
 * screen and on a door, where those are not asked, the password check's own
 * answer does. It is asked on every page in any case.
 */
function useDevModeUntil(): string | null | undefined {
  const status = useQuery(siteStatusQuery);
  const onDoor = useGateMode() === 'door';
  // Never asked while locked: on the lock screen a call behind the gate is
  // refused, and asking at all is more than that screen may do.
  const past = status.data?.locked !== true && !onDoor;
  const site = useQuery({ ...siteQuery, enabled: past });
  return past && site.data ? site.data.dev_mode_until : status.data?.dev_mode_until;
}

export function DevBadge() {
  const until = useDevModeUntil();
  const active = useDevModeActive(until);
  if (!active) return null;
  return (
    <Dialog>
      <DialogTrigger className="fixed right-4 bottom-[calc(max(var(--rl-savebar-height,0px),var(--rl-bottom-bar-height,0px))+1rem)] z-30 flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-raised print:hidden">
        <span aria-hidden="true" className="size-2 rounded-full bg-ink-alt" />
        Under active development
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This site is under active development</DialogTitle>
          <DialogDescription>New versions are going out while you use it.</DialogDescription>
        </DialogHeader>
        <p>
          You may run into pages that look broken, behave oddly, or change shape while you are using
          them. If something is not working, wait a few minutes and reload the page before assuming
          it is broken for good.
        </p>
        <p>
          Reports you file are not affected by any of this. Everything submitted is kept permanently
          the moment it is confirmed.
        </p>
      </DialogContent>
    </Dialog>
  );
}
