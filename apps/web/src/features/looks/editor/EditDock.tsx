/**
 * The one Edit button in the corner, for administrators and the owner only
 * (the owner's call, 28 Oct, in place of separate Look and Edit this page
 * pills): a pencil that opens a short menu, Edit this page where the page can
 * be edited, and Edit the look. Never in a preview frame or on a door, and
 * hidden while the look editor is open.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useGateMode } from '../../identity/gateMode.ts';
import { useMe } from '../../identity/session.ts';
import { inPreviewFrame } from './override.ts';
import { usePageEdit } from './pageEdit.ts';
import { setLookEditorOpen } from './state.ts';

export function EditDock() {
  const door = useGateMode() === 'door';
  const me = useMe().data;
  const staff = me?.signedIn === true && me.roles.some((r) => r === 'admin' || r === 'owner');
  if (door || inPreviewFrame || !staff) return null;
  return <EditMenu />;
}

function EditMenu() {
  const [open, setOpen] = useState(false);
  const pageEdit = usePageEdit();
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
      {open ? (
        <div id={menu} className="dock-menu" role="group" aria-label="Edit">
          {pageEdit ? (
            <button type="button" onClick={choose(pageEdit)}>
              Edit this page
            </button>
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
