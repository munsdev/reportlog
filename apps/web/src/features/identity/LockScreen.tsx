/**
 * The password screen. All that stands between a visitor and the site while
 * the gate is on, so it shows nothing of what is behind it: no menu, no
 * name of a logbook that is not on offer. Only what an administrator chose
 * to offer without the password (the doors), as plain links.
 */
import { listDoors, unlockSite } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { ErrorText, TextField } from './ui.tsx';

export function LockScreen({ onUnlocked }: { onUnlocked: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const doors = useQuery({
    queryKey: ['site-access', 'doors'],
    queryFn: ({ signal }) => call(listDoors, { signal }),
    staleTime: 60_000,
  });
  const unlock = useMutation({
    mutationFn: () => call(unlockSite, { body: { password } }),
    onSuccess: onUnlocked,
  });

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-12"
    >
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold">This site needs a password</h1>
        <p className="text-ink-alt">
          It is not open to the public yet. If you were given the password, enter it here.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (password) unlock.mutate();
        }}
      >
        <TextField
          label="Site password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <ErrorText error={unlock.error} />
        <Button type="submit" disabled={unlock.isPending}>
          Enter
        </Button>
      </form>
      {doors.data && doors.data.doors.length > 0 && (
        <nav aria-label="Open without the password" className="space-y-2 border-t border-line pt-6">
          <p>No password? You can still:</p>
          <ul className="list-disc space-y-1 pl-6">
            {doors.data.doors.map((d) => (
              <li key={d.href}>
                {/* A plain link, not the router's: following it loads the page
                    fresh, through the gate, like a link somebody was sent. */}
                <a href={d.href} className="underline">
                  {d.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </main>
  );
}
