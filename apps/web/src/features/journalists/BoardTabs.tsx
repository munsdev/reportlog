/**
 * The board's two journalist tabs (decision 81): the checked links and the
 * written accounts, laid out like the report list but with these in it. Only
 * a journalist who has accepted the agreement sees the tabs; anyone else who
 * opens the address is sent to the door, which asks for what is missing.
 */
import { Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Note } from '../../mockup/Note.tsx';
import { BoardFrame } from '../board/BoardFrame.tsx';
import { useMe } from '../identity/session.ts';
import { useJournalistAccess } from './access.ts';
import { CheckedLinks, Texts } from './Desk.tsx';

function JournalistTab({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: ReactNode;
}) {
  const me = useMe();
  const access = useJournalistAccess();
  if (me.isPending || access === 'loading') return <p role="status">Loading…</p>;
  if (access !== 'yes') return <Navigate to="/desk" replace />;
  return (
    <BoardFrame title={title} lede={lede}>
      {children}
    </BoardFrame>
  );
}

export function JournalistLinks() {
  return (
    <JournalistTab
      title="Checked links"
      lede="Links from the tip line and from reports that a moderator has checked. For journalists; nothing here is public."
    >
      <Note warn>
        <span>
          <b>Before you use a link</b> A moderator checked each link, but did not verify what it
          shows. Treat it as a lead, not as a fact. Copying one is your choice: this site never
          opens it.
        </span>
      </Note>
      <CheckedLinks />
      <p className="m">Every page you open here is recorded in the access log.</p>
    </JournalistTab>
  );
}

export function JournalistAccounts() {
  return (
    <JournalistTab
      title="Written accounts"
      lede="Notes a moderator wrote from reporters' accounts, shared with the reporters' permission. For journalists; nothing here is public."
    >
      <Note warn>
        <span>
          <b>Before you use one</b> Written by a moderator from a reporter&rsquo;s account. The
          reporter&rsquo;s own words are shown only where quoted. A note is not a verified fact, and
          reporters can take it back.
        </span>
      </Note>
      <Texts />
      <p className="m">
        Every page you open here is recorded in the access log. If a reporter erases or stops
        sharing an account, it disappears from here.
      </p>
    </JournalistTab>
  );
}
