/**
 * What a form shows in place of its opening card when it cannot take a
 * report or an entry: not open yet, closed, paused, switched off, or not
 * there at all (filing.md §11). Same column as the cards, no progress rule.
 *
 * NONE IS A DEAD END: each links to the front page and the board. Except on
 * a door, where both are behind the site password, and a link to them would
 * only lead back to the password screen. Plain links, not the router's:
 * these pages are drawn on doors and in bare unit renders alike.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow } from '@/components/ui/type.tsx';
import { useGateMode } from '@/features/identity/gateMode.ts';

export function FormColumn({ children }: { children: ReactNode }) {
  return <section className="flex w-full max-w-[40rem] flex-col gap-6">{children}</section>;
}

export function FormNotice({
  eyebrow = 'File a report',
  title,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const onDoor = useGateMode() === 'door';
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <FormColumn>
      <div className="flex flex-col gap-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="font-display text-title">{title}</h1>
      </div>
      {children}
      {onDoor ? null : (
        <ul className="flex flex-wrap gap-3" aria-label="Where to go instead">
          <li>
            <Button asChild variant="secondary">
              <a href="/">The front page</a>
            </Button>
          </li>
          <li>
            <Button asChild variant="secondary">
              <a href="/board">The board</a>
            </Button>
          </li>
        </ul>
      )}
    </FormColumn>
  );
}
