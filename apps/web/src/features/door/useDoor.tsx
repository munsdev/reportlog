/**
 * What a report or tip form does at the door (apps/api/src/door/), so the
 * server takes what it sends:
 *
 *   - asks for a START TOKEN as the form opens, and keeps it for as long as the
 *     page is open: the server refuses a form sent too soon after it;
 *   - solves the PUZZLE in the background with the ALTCHA widget, served from
 *     this site (widget.ts), and holds Send until it is solved;
 *   - carries a HIDDEN BOX nobody can see, which only a script fills in.
 *
 * A refusal at the door is one plain sentence that never says which check
 * failed. The page shows it and quietly fetches a fresh puzzle, so pressing
 * Send again is all anybody has to do. A solution is used once, so a fresh
 * one is fetched after every send, refused or not.
 *
 * ON A DOOR these calls pass: the challenge and the start token are in front
 * of the site password (IN_FRONT in apps/api/src/identity/gate.ts).
 */
import { DOOR_CHALLENGE_PATH, getDoorStart } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/api.ts';

// Declared by the widget's own types, which widget.ts brings in.
type AltchaWidgetElement = HTMLElementTagNameMap['altcha-widget'];

export interface DoorFields {
  website: string;
  start: string;
  altcha: string;
}

export interface Door {
  /** Whether Send may go: the start token is in, and the puzzle is solved. */
  ready: boolean;
  /** Set if the puzzle could not be solved, in words for the page. */
  failed: boolean;
  /** What to send with the form. Null until ready. */
  fields: () => DoorFields | null;
  /** After a send: the solution is spent, so solve a fresh one. */
  renew: () => void;
  /** The hidden box's value and setter, for <Honeypot>. */
  website: string;
  setWebsite: (v: string) => void;
  /** Where the widget lives on the page. Render <DoorPuzzle door={door} />. */
  host: (el: HTMLDivElement | null) => void;
}

export function useDoor(): Door {
  // Asked once, as the form opens. Never refetched: the moment it carries is
  // the moment the form was opened, and a newer one would restart the clock.
  const start = useQuery({
    queryKey: ['door', 'start'],
    queryFn: ({ signal }) => call(getDoorStart, { signal }),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 3,
  });
  const [payload, setPayload] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [website, setWebsite] = useState('');
  const [widget, setWidget] = useState<AltchaWidgetElement | null>(null);
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostEl) return;
    let cancelled = false;
    let el: AltchaWidgetElement | null = null;
    const onState = (e: Event) => {
      const detail = (e as CustomEvent<{ payload?: string | null; state?: string }>).detail;
      if (detail.state === 'verified' && detail.payload) {
        setPayload(detail.payload);
        setFailed(false);
      } else if (detail.state === 'expired') {
        // Left open past its expiry: solve a new one, quietly.
        setPayload(null);
        void el?.verify();
      } else if (detail.state === 'error') {
        setPayload(null);
        setFailed(true);
      } else {
        setPayload(null);
      }
    };
    void import('./widget.ts').then(() => {
      if (cancelled) return;
      el = document.createElement('altcha-widget');
      // As attributes, before it is on the page: its methods exist only once
      // it is, and by then "onload" has already started.
      el.setAttribute('challenge', DOOR_CHALLENGE_PATH);
      // In the background, from the moment the form opens, with nothing to
      // press: the reporter is answering questions while it works.
      el.setAttribute('auto', 'onload');
      el.setAttribute('display', 'invisible');
      el.setAttribute(
        'configuration',
        JSON.stringify({
          // Nothing about how somebody moves the mouse is collected, and the
          // widget names no other site.
          humanInteractionSignature: false,
          hideLogo: true,
          hideFooter: true,
        }),
      );
      el.addEventListener('statechange', onState);
      hostEl.appendChild(el);
      setWidget(el);
    });
    return () => {
      cancelled = true;
      el?.removeEventListener('statechange', onState);
      el?.remove();
      setWidget(null);
    };
  }, [hostEl]);

  const renew = useCallback(() => {
    setPayload(null);
    setFailed(false);
    if (!widget) return;
    widget.reset();
    void widget.verify();
  }, [widget]);

  const startToken = start.data?.start;
  return {
    ready: Boolean(startToken && payload),
    failed: failed || start.isError,
    fields: () => (startToken && payload ? { website, start: startToken, altcha: payload } : null),
    renew,
    website,
    setWebsite,
    host: setHostEl,
  };
}

/** Where the widget sits. It shows nothing (display "invisible"). */
export function DoorPuzzle({ door }: { door: Door }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const { host } = door;
  useEffect(() => {
    host(el);
  }, [host, el]);
  return <div ref={setEl} aria-hidden="true" style={{ display: 'none' }} />;
}

/**
 * THE HIDDEN BOX. Off the page for people, skipped by screen readers
 * (aria-hidden), out of the tab order, and not autofilled. Only something
 * that fills in every box it finds puts anything in it.
 */
export function Honeypot({ door }: { door: Pick<Door, 'website' | 'setWebsite'> }) {
  return (
    <div aria-hidden="true" className="vh">
      <label>
        Leave this empty
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={door.website}
          onChange={(e) => {
            door.setWebsite(e.target.value);
          }}
        />
      </label>
    </div>
  );
}

/** The line beside Send while the puzzle is being solved, or if it could not be. */
export function doorStatus(door: Door): string | null {
  if (door.failed) return 'This form could not get ready to send. Reload the page and try again.';
  if (!door.ready) return 'Getting ready to send…';
  return null;
}

/**
 * Send, pressed before the puzzle is solved: the press is kept, the button
 * says "Sending…", and the form goes the moment the door is ready, rather
 * than the button being dead with no reason given. Nothing is sent that the
 * person did not press for, and a door that cannot get ready drops the
 * press and says so (doorStatus).
 */
export function useSendWhenReady(
  door: Door,
  /** The send: a mutation's `mutate`, and when it was last called. */
  send: { mutate: () => void; submittedAt: number },
) {
  // When the person pressed. A press is still waiting until the send has been
  // made since, so a send that fails and a puzzle renewed afterwards never
  // send again without another press.
  const [pressedAt, setPressedAt] = useState(0);
  const waiting = pressedAt > send.submittedAt && !door.failed;
  const { mutate } = send;
  useEffect(() => {
    if (waiting && door.ready) mutate();
  }, [waiting, door.ready, mutate]);
  return {
    waiting,
    press: () => {
      if (door.ready) mutate();
      else if (!door.failed) setPressedAt(Date.now());
    },
  };
}
