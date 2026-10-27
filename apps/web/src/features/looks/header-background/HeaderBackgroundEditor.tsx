/**
 * The header background editor: one component for the Look screen (and, when
 * the page editor wants it, for "Edit header background" on the front page
 * block). It is controlled: it shows `header` and says what changed; saving
 * is the caller's. The image is the one thing that goes to the server at
 * once (a file cannot be held in a draft), through `onPickImage`.
 *
 * Wording and order are the mock-up's (docs/ui-mockup/src/site.js, bgEditor):
 * Elements, Big shapes, Image, Fade. Every chip is a real button with
 * `aria-pressed`, 44px tall; every slider has a label and a visible value.
 */
import type { HeaderBackground, ShapeStyle } from '@reportlog/contracts';
import {
  FADES,
  IMAGE_MODES,
  IMAGE_PLACES,
  IMAGE_TONES,
  headerImagePath,
} from '@reportlog/contracts';
import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';
import type { Kit } from './scene.ts';

const FADE_LABEL: Record<(typeof FADES)[number], string> = {
  side: 'From the side',
  bottom: 'Toward the bottom',
  radial: 'Spotlight',
  none: 'None',
};
const PLACE_LABEL: Record<(typeof IMAGE_PLACES)[number], string> = {
  behind: 'Behind',
  shape: 'Inside a shape',
  taped: 'Taped print',
};
const MODE_LABEL: Record<(typeof IMAGE_MODES)[number], string> = {
  under: 'Elements on top',
  replace: 'Image only',
};
const TONE_LABEL: Record<(typeof IMAGE_TONES)[number], string> = {
  color: 'Full color',
  mono: 'Black and white',
  dark: 'Darkened',
};

export function ToggleChip({
  pressed,
  onClick,
  children,
  tick = false,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  /** A switch shows a tick when on, so it is not colour alone that says so. */
  tick?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] px-3 text-sm',
        pressed ? 'border-ink bg-ink text-paper' : 'border-ink-alt bg-surface text-ink',
      )}
    >
      {tick && pressed ? <span aria-hidden="true">{'✓'}</span> : null}
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 text-sm">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id} className="font-mono text-xs text-muted">
        {format(value)}
      </output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        className="col-span-2 min-h-11 w-full accent-ink"
      />
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="text-sm font-bold">{title}</h3>
      {children}
      {note ? <p className="text-xs text-muted">{note}</p> : null}
    </section>
  );
}

const pct = (v: number) => `${String(Math.round(v * 100))}%`;

export interface HeaderBackgroundEditorProps {
  header: HeaderBackground;
  onChange: (next: HeaderBackground) => void;
  kit: Kit;
  onPickImage: (file: File) => void;
  onRemoveImage: () => void;
  /** What happened to the last image: "Image added.", or why not. */
  imageMessage?: string | undefined;
  busy?: boolean;
}

export function HeaderBackgroundEditor({
  header: B,
  onChange,
  kit,
  onPickImage,
  onRemoveImage,
  imageMessage,
  busy = false,
}: HeaderBackgroundEditorProps) {
  const fileId = useId();
  const input = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<HeaderBackground>) => {
    onChange({ ...B, ...patch });
  };
  const shapes = kit.elements.filter((e) => e.kind === 'shape');
  const img = B.image;
  const setImage = (patch: Partial<NonNullable<HeaderBackground['image']>>) => {
    if (img) set({ image: { ...img, ...patch } });
  };

  return (
    <div className="grid gap-5">
      <Group title="Elements" note="Each one is on or off. With none on, the header is plain.">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Elements">
          {kit.elements.map((e) => (
            <ToggleChip
              key={e.id}
              tick
              pressed={Boolean(B.on[e.id])}
              onClick={() => {
                set({ on: { ...B.on, [e.id]: !B.on[e.id] } });
              }}
            >
              {e.label}
            </ToggleChip>
          ))}
        </div>
        <Slider
          label="Lines, stars, stripes"
          value={B.pattern}
          min={0.04}
          max={0.4}
          step={0.01}
          format={pct}
          onChange={(pattern) => {
            set({ pattern });
          }}
        />
      </Group>

      {shapes.length ? (
        <Group title="Big shapes">
          <div className="grid gap-2">
            {shapes
              .filter((e) => B.on[e.id])
              .map((e) => {
                const current: ShapeStyle = B.style[e.id] ?? e.style ?? 'filled';
                return (
                  <div
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-sm"
                  >
                    <span>{e.label}</span>
                    <div className="flex gap-1.5" role="group" aria-label={`${e.label} style`}>
                      {(['filled', 'outline'] as const).map((style) => (
                        <ToggleChip
                          key={style}
                          pressed={current === style}
                          onClick={() => {
                            set({ style: { ...B.style, [e.id]: style } });
                          }}
                        >
                          {style === 'filled' ? 'Filled' : 'Outline'}
                        </ToggleChip>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
          <Slider
            label="Shape strength"
            value={B.shapes}
            min={0.05}
            max={0.6}
            step={0.01}
            format={pct}
            onChange={(v) => {
              set({ shapes: v });
            }}
          />
        </Group>
      ) : null}

      <Group
        title="Image"
        note="Only the front-page header uses the image. No stock photos are loaded from anywhere; the file stays on this site."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            id={fileId}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPickImage(file);
              e.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            busy={busy}
            busyLabel="Sending…"
            onClick={() => {
              input.current?.click();
            }}
          >
            {img ? 'Replace image' : 'Add an image'}
          </Button>
          {img ? (
            <Button variant="quiet" onClick={onRemoveImage} disabled={busy}>
              Remove image
            </Button>
          ) : null}
        </div>
        {img ? (
          <img
            src={headerImagePath(img.file)}
            alt="Current header"
            className="h-21 w-full rounded-control border-[1.5px] border-ink-alt object-cover"
          />
        ) : null}
        <p role="status" className="text-xs text-muted">
          {imageMessage}
        </p>
        {img ? (
          <div className="grid gap-2">
            <span className="text-xs text-muted">Place</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Place">
              {IMAGE_PLACES.map((place) => (
                <ToggleChip
                  key={place}
                  pressed={img.place === place}
                  onClick={() => {
                    setImage({ place });
                  }}
                >
                  {PLACE_LABEL[place]}
                </ToggleChip>
              ))}
            </div>
            {img.place === 'shape' ? (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which shape">
                {shapes.map((e) => (
                  <ToggleChip
                    key={e.id}
                    pressed={img.shape === e.id}
                    onClick={() => {
                      setImage({ shape: e.id });
                    }}
                  >
                    {e.label}
                  </ToggleChip>
                ))}
              </div>
            ) : null}
            <span className="text-xs text-muted">With the elements</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="With the elements">
              {IMAGE_MODES.map((mode) => (
                <ToggleChip
                  key={mode}
                  pressed={img.mode === mode}
                  onClick={() => {
                    setImage({ mode });
                  }}
                >
                  {MODE_LABEL[mode]}
                </ToggleChip>
              ))}
            </div>
            <span className="text-xs text-muted">Color</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Color">
              {IMAGE_TONES.map((tone) => (
                <ToggleChip
                  key={tone}
                  pressed={img.tone === tone}
                  onClick={() => {
                    setImage({ tone });
                  }}
                >
                  {TONE_LABEL[tone]}
                </ToggleChip>
              ))}
            </div>
            <Slider
              label="Image strength"
              value={img.strength}
              min={0.1}
              max={1}
              step={0.01}
              format={pct}
              onChange={(strength) => {
                setImage({ strength });
              }}
            />
            <Slider
              label="Focus, left to right"
              value={img.focus}
              min={0}
              max={100}
              step={1}
              format={(v) => `${String(v)}%`}
              onChange={(focus) => {
                setImage({ focus });
              }}
            />
          </div>
        ) : null}
      </Group>

      <Group
        title="Fade"
        note="Keeps the headline side clear. On a phone a side fade becomes a fade toward the bottom."
      >
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fade">
          {FADES.map((kind) => (
            <ToggleChip
              key={kind}
              pressed={B.fade.kind === kind}
              onClick={() => {
                set({ fade: { ...B.fade, kind } });
              }}
            >
              {FADE_LABEL[kind]}
            </ToggleChip>
          ))}
        </div>
        <Slider
          label="Fade strength"
          value={B.fade.strength}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(strength) => {
            set({ fade: { ...B.fade, strength } });
          }}
        />
      </Group>
    </div>
  );
}
