/**
 * The one Edit button in the corner, for administrators and the owner only
 * (the owner's call, 28 Oct, in place of separate Look and Edit this page
 * pills): a pencil that opens a short menu, Edit this page where the page can
 * be edited, and Edit the look. Never in a preview frame or on a door, and
 * hidden while the look editor is open.
 *
 * On every page with wording of its own it also offers "Edit this page's
 * words" (the owner's call, 28 Oct: the pencil everywhere, no new block
 * pages), and on the legal page the way to the legal notices.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';
import { Suspense, lazy, useEffect, useId, useRef, useState } from 'react';
import { useGateMode } from '../../identity/gateMode.ts';
import { meQuery } from '../../identity/session.ts';
import { inPreviewFrame } from './override.ts';
import { usePageEdit } from './pageEdit.ts';
import { slotsOn } from './pageWords.ts';

// Only an administrator who opens it downloads the settings code it uses.
const PageWords = lazy(() => import('./PageWords.tsx'));
import { setLookEditorOpen } from './state.ts';

export function EditDock() {
  const door = useGateMode() === 'door';
  // Never asked on a door: who is signed in is behind the password, and a
  // refused call there makes the gate take the door back (gate.tsx).
  const me = useQuery({ ...meQuery, enabled: !door }).data;
  const staff = me?.signedIn === true && me.roles.some((r) => r === 'admin' || r === 'owner');
  if (door || inPreviewFrame || !staff) return null;
  return <EditMenu />;
}

function EditMenu() {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState(false);
  const pageEdit = usePageEdit();
  const { pathname } = useLocation();
  const slots = slotsOn(pathname);
  const legal = pathname.replace(/\/+$/, '') === '/legal';
  const menu = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target))
        setOpen(false);
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
  const choose = (go: () => void) => () => {
    setOpen(false);
    go();
  };
  return (
    <div ref={root} className="dock-menu-wrap">
      {words ? (
        <Suspense fallback={null}>
          <PageWords
            slots={slots}
            onClose={() => {
              setWords(false);
              button.current?.focus();
            }}
          />
        </Suspense>
      ) : null}
      {open ? (
        <div id={menu} className="dock-menu" role="group" aria-label="Edit">
          {pageEdit ? (
            <button type="button" onClick={choose(pageEdit)}>
              Edit this page
            </button>
          ) : null}
          {slots.length ? (
            <button
              type="button"
              onClick={choose(() => {
                setWords(true);
              })}
            >
              Edit this page’s words
            </button>
          ) : null}
          {legal ? (
            <Link
              to="/settings/legal"
              onClick={() => {
                setOpen(false);
              }}
            >
              Edit the legal notices
            </Link>
          ) : null}
          <button
            type="button"
            onClick={choose(() => {
              setLookEditorOpen(true);
            })}
          >
            Edit the look
          </button>
        </div>
      ) : null}
      <button
        ref={button}
        type="button"
        className="lookfab dock-pill"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        aria-label="Edit"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
          />
        </svg>
        <span className="dock-label">Edit</span>
      </button>
    </div>
  );
}
