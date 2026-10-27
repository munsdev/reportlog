/**
 * The password screen (public.md §11). All that stands between a visitor and
 * the site while the gate is on, so it shows nothing of what is behind it: no
 * header, no menu, no footer, no name of a logbook that is not on offer. Only
 * the site's name and the paragraph its operator wrote for this screen
 * (decisions.md §3), both carried by the password check itself, and what an
 * administrator chose to offer without the password (the doors), as plain
 * links.
 *
 * IT WEARS THE SITE'S LOOK (decision 60): the palette and theme come with the
 * password check and the gate paints them (gate.tsx), the remembered look
 * first so there is no flash. The whole screen is the deep surface.
 */
import { listDoors, unlockSite } from '@reportlog/contracts';
import type { LockScreenSite } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { DevBadge } from '@/components/ui/dev-badge.tsx';
import { BrandName } from '@/components/ui/site.tsx';
import { ApiRequestError, call } from '../../lib/api.ts';

/** The refusal, in the words the design gives it; anything else as the server said it. */
function refusal(error: Error): string {
  return error instanceof ApiRequestError && error.status === 401
    ? 'That password is not right.'
    : error.message;
}

export function LockScreen({
  site,
  onUnlocked,
}: {
  site?: LockScreenSite | undefined;
  onUnlocked: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const doors = useQuery({
    queryKey: ['site-access', 'doors'],
    queryFn: ({ signal }) => call(listDoors, { signal }),
    staleTime: 60_000,
  });
  const unlock = useMutation({
    mutationFn: () => call(unlockSite, { body: { password } }),
    onSuccess: onUnlocked,
  });
  // After a wrong password, back to the field, so it can be typed again.
  useEffect(() => {
    if (unlock.isError) field.current?.focus();
  }, [unlock.isError, unlock.failureCount]);
  useEffect(() => {
    document.title = site ? `${site.plain_name} · Password` : 'Password';
  }, [site]);

  return (
    <div className="grid min-h-dvh place-items-center bg-deep px-[max(0.5rem,env(safe-area-inset-left))] py-8 text-on-deep">
      {/* The mock-up's box: a light edge round a darker panel on the deep ground. */}
      <main
        id="main"
        className="grid w-[min(420px,92vw)] gap-[18px] rounded-card border-[3px] border-on-deep bg-deeper p-7"
      >
        {site ? (
          <p className="font-display text-[1.625rem] leading-tight font-bold" data-site-name>
            <BrandName parts={site.name_parts} onDeep />
          </p>
        ) : null}
        <h1 className="label-face text-xs text-on-deep-muted">This site needs a password</h1>
        {site?.intro ? (
          // The operator's own words: plain text with their line breaks, never HTML.
          <p data-copy="lock_intro" className="whitespace-pre-wrap text-on-deep-muted">
            {site.intro}
          </p>
        ) : null}
        <form
          className="flex flex-col gap-[18px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) unlock.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="site-password" className="label-face text-[0.8125rem] text-on-deep">
              Site password
            </label>
            <input
              ref={field}
              id="site-password"
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={unlock.isError || undefined}
              aria-describedby={unlock.isError ? 'site-password-error' : undefined}
              className="min-h-11 w-full rounded-control border-[1.5px] border-on-deep-muted bg-surface px-3.5 py-2 text-base text-ink"
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          </div>
          {unlock.isError ? (
            <Alert tone="serious" id="site-password-error">
              {refusal(unlock.error)}
            </Alert>
          ) : null}
          <Button
            type="submit"
            size="lg"
            block
            className="border-on-deep shadow-[4px_4px_0_var(--rl-text-on-deep)]"
            busy={unlock.isPending}
            busyLabel="Checking…"
          >
            Continue
          </Button>
        </form>
        {doors.data && doors.data.doors.length > 0 ? (
          <nav
            aria-labelledby="doors-heading"
            className="grid gap-1.5 border-t border-line-on-deep pt-3.5"
          >
            <h2 id="doors-heading" className="label-face mb-2 text-xs text-on-deep-muted">
              Open without the password
            </h2>
            <ul>
              {doors.data.doors.map((d) => (
                <li key={d.href}>
                  {/* A plain link, not the router's: following it loads the page
                      fresh, through the gate, like a link somebody was sent. */}
                  <a
                    href={d.href}
                    className="flex min-h-11 items-center text-on-deep underline underline-offset-4"
                  >
                    {/* A list's title already says what it takes ("Send a link"). */}
                    {d.kind === 'logbook' ? `File a report: ${d.title}` : d.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <DevBadge />
      </main>
    </div>
  );
}
