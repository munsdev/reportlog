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
 * first so there is no flash. The markup is the mock-up's door.html: the
 * `door` page ground and a `.door-box` form.
 */
import { listDoors, unlockSite } from '@reportlog/contracts';
import type { LockScreenSite } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { DevBadge } from '@/components/ui/dev-badge.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { BrandRuns } from '../../mockup/Wordmark.tsx';
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
  useBodyClass('dark', 'door');
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
    <main id="main">
      <form
        className="door-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (password) unlock.mutate();
        }}
      >
        {site ? (
          <span className="wm" aria-label={site.plain_name}>
            <BrandRuns parts={site.name_parts} />
          </span>
        ) : null}
        <h1 className="eyebrow">This site needs a password</h1>
        {site?.intro ? (
          // The operator's own words: plain text with their line breaks, never HTML.
          <p data-copy="lock_intro">{site.intro}</p>
        ) : null}
        <div className="field">
          <label htmlFor="site-password">Site password</label>
          <input
            ref={field}
            className="input"
            id="site-password"
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={unlock.isError || undefined}
            aria-describedby={unlock.isError ? 'site-password-error' : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </div>
        {unlock.isError ? (
          <p id="site-password-error" role="alert">
            {refusal(unlock.error)}
          </p>
        ) : null}
        <button className="btn go lg" type="submit" disabled={unlock.isPending}>
          {unlock.isPending ? 'Checking…' : 'Continue'}
        </button>
        {doors.data && doors.data.doors.length > 0 ? (
          <nav aria-labelledby="doors-heading">
            <h2 id="doors-heading" className="eyebrow">
              Open without the password
            </h2>
            {doors.data.doors.map((d) => (
              // A plain link, not the router's: following it loads the page
              // fresh, through the gate, like a link somebody was sent. A
              // list's title already says what it takes ("Send a link").
              <a key={d.href} href={d.href}>
                {d.kind === 'logbook' ? `File a report: ${d.title}` : d.title}
              </a>
            ))}
          </nav>
        ) : null}
        <DevBadge />
      </form>
    </main>
  );
}
