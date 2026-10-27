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
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { useGateMode } from '@/features/identity/gateMode.ts';
import { BtnLink } from '@/mockup/Btn.tsx';
import { useBodyClass } from '@/mockup/useBodyClass.ts';

/**
 * The page ground of every filing page: the mock-up's `body.light.form`,
 * and its `.wrap` column. The cards go in a `.qcard` form inside it.
 */
export function FormColumn({ children }: { children: ReactNode }) {
  useBodyClass('light', 'form');
  return (
    <div data-bleed>
      <div className="wrap">{children}</div>
    </div>
  );
}

/**
 * The mock-up's page for a state with no card: the eyebrow, a big title,
 * then what there is to say (file-limit.html, file-check-email.html). It
 * focuses nothing and has no bar.
 */
export function NoticeColumn({ children }: { children: ReactNode }) {
  useBodyClass('light', 'form');
  return (
    <div data-bleed>
      <div className="wrap" style={{ paddingTop: 30 }}>
        <div style={{ display: 'grid', gap: 18, maxWidth: 640 }}>{children}</div>
      </div>
    </div>
  );
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
    <NoticeColumn>
      <span className="eyebrow">{eyebrow}</span>
      <h1 className="h-page" id="h1">
        {title}
      </h1>
      {children}
      {onDoor ? null : (
        <div className="btn-row" aria-label="Where to go instead" role="group">
          <BtnLink href="/">The front page</BtnLink>
          <BtnLink href="/board">The board</BtnLink>
        </div>
      )}
    </NoticeColumn>
  );
}
