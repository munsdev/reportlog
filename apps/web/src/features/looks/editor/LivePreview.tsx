/**
 * The site itself, in a frame, wearing a look it is not wearing yet: the
 * real page at a desktop's or a phone's width, drawn smaller to fit. Not a
 * copy of the page, so whatever the page script paints (the Civic palettes,
 * Poster, the header background) is in the preview as it will be on the site.
 *
 * The frame is this site at the same address (frame-ancestors 'self' in the
 * Caddyfile). It is told the look by a message, again whenever the look
 * changes and whenever the frame says it is ready (a navigation inside it).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PREVIEW_FRAME } from './override.ts';
import type { LookDraft, LookMessage } from './override.ts';

const SIZE = { desktop: [1280, 820], phone: [390, 780] } as const;

export type Device = keyof typeof SIZE;

export function LivePreview({
  path,
  device,
  look,
  maxHeight,
}: {
  path: string;
  device: Device;
  look: LookDraft;
  /** The tallest the drawn frame may be, in px; the page inside keeps its own height. */
  maxHeight?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(0);
  const [w, h] = SIZE[device];

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => {
      setWidth(el.clientWidth);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, []);

  const send = () => {
    const msg: LookMessage = { type: 'rl-look', look };
    frame.current?.contentWindow?.postMessage(msg, window.location.origin);
  };
  // Again on every change of look, and whenever the frame says it is listening.
  useEffect(send);
  useEffect(() => {
    const ready = (e: MessageEvent<unknown>) => {
      if (e.origin !== window.location.origin) return;
      if (e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: string } | null)?.type === 'rl-look-ready') send();
    };
    window.addEventListener('message', ready);
    return () => {
      window.removeEventListener('message', ready);
    };
  });

  const fit = width ? Math.min(1, width / w, maxHeight ? maxHeight / h : 1) : 0;
  return (
    <div ref={box} className="live-preview" data-device={device}>
      <div style={{ width: w * fit, height: h * fit, margin: '0 auto', overflow: 'hidden' }}>
        <iframe
          ref={frame}
          name={PREVIEW_FRAME}
          src={path}
          title={device === 'phone' ? 'The page on a phone' : 'The page on a desktop'}
          width={w}
          height={h}
          style={{
            border: 0,
            width: w,
            height: h,
            transform: `scale(${String(fit)})`,
            transformOrigin: '0 0',
          }}
        />
      </div>
    </div>
  );
}
