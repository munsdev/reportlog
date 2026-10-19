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
 */
import { useEffect, useState } from 'react';
import { useSite } from './site.tsx';
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

export function DevBadge() {
  const until = useSite().data?.dev_mode_until;
  const active = useDevModeActive(until);
  if (!active) return null;
  return (
    <Dialog>
      <DialogTrigger className="fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-raised print:hidden">
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
