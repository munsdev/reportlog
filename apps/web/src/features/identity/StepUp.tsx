/**
 * The step-up dialog (plan E, E3): the second factor again before one of the
 * few actions that ask for it, good for five minutes.
 *
 * Mounted once, in the root layout. It registers itself with the API client
 * (lib/api.ts), so any call the server answers with `step_up_required`
 * opens this dialog and, once the person has proved it, is made again. No
 * screen needs to know which of its buttons ask. A plain link to a file
 * (a backup, the complete chain file) is not a call, so its screen asks
 * `ensureStepUp()` first.
 */
import { getMe } from '@reportlog/contracts';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/mockup/Modal.tsx';
import { call, setStepUpHandler } from '../../lib/api.ts';
import { ProveIt } from './secondFactor.tsx';

let open: (() => Promise<boolean>) | null = null;

/**
 * True once a step-up counts for long enough to use: asks for one if not.
 * False if the person closed the dialog.
 */
export async function ensureStepUp(): Promise<boolean> {
  const me = await call(getMe);
  // A minute to spare, so it does not run out between here and the server.
  if (me.signedIn && me.stepUpUntil && Date.parse(me.stepUpUntil) - Date.now() > 60_000) {
    return true;
  }
  return open ? open() : false;
}

export function StepUpHost() {
  const [asking, setAsking] = useState(false);
  const settle = useRef<((proved: boolean) => void) | null>(null);

  useEffect(() => {
    const ask = () =>
      new Promise<boolean>((resolve) => {
        // A second ask while one is open waits on the same answer.
        const before = settle.current;
        settle.current = (proved) => {
          before?.(proved);
          resolve(proved);
        };
        setAsking(true);
      });
    open = ask;
    setStepUpHandler(ask);
    return () => {
      open = null;
      setStepUpHandler(null);
    };
  }, []);

  const finish = (proved: boolean) => {
    const s = settle.current;
    settle.current = null;
    setAsking(false);
    s?.(proved);
  };

  return (
    <Dialog
      open={asking}
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm it is you</DialogTitle>
          <DialogDescription>
            This asks for your second factor again. It then counts for five minutes.
          </DialogDescription>
        </DialogHeader>
        {asking && (
          <ProveIt
            intro={null}
            onProved={() => {
              finish(true);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A download link to a file that asks for a step-up (a backup, an export).
 * A link is no API call, so this asks first and then follows itself.
 */
export function StepUpDownload({
  href,
  children,
  ...props
}: ComponentProps<'a'> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      download
      onClick={(e) => {
        e.preventDefault();
        void ensureStepUp().then((ok) => {
          if (!ok) return;
          const a = document.createElement('a');
          a.href = href;
          a.download = '';
          document.body.append(a);
          a.click();
          a.remove();
        });
      }}
    >
      {children}
    </a>
  );
}
