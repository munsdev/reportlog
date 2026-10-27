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
      className="bge-chip"
      // The stylesheet draws the tick on a pressed element chip (data-tog).
      {...(tick ? { 'data-tog': '' } : {})}
    >
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
    <div className="bge-slider">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{format(value)}</output>
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
      />
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="bge-g" aria-label={title}>
      <h4>{title}</h4>
      {children}
      {note ? <p className="bge-note">{note}</p> : null}
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
    <div className="bge">
      <Group title="Elements" note="Each one is on or off. With none on, the header is plain.">
        <div className="bge-row" role="group" aria-label="Elements">
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
          <div className="bge-shapes">
            {/* Every shape, on or off, as in the mock-up's Look screen. */}
            {shapes.map((e) => {
              const current: ShapeStyle = B.style[e.id] ?? e.style ?? 'filled';
              return (
                <div key={e.id} className="bge-shape">
                  <span>{e.label}</span>
                  <div className="bge-row" role="group" aria-label={`${e.label} style`}>
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
        <div className="bge-row">
          <input
            ref={input}
            id={fileId}
            type="file"
            accept="image/*"
            className="vh"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPickImage(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="bge-btn"
            aria-busy={busy || undefined}
            disabled={busy}
            onClick={() => {
              input.current?.click();
            }}
          >
            {busy ? 'Sending…' : img ? 'Replace image' : 'Add an image'}
          </button>
          {img ? (
            <button type="button" className="bge-btn ghost" onClick={onRemoveImage} disabled={busy}>
              Remove image
            </button>
          ) : null}
        </div>
        {img ? (
          <div
            className="bge-thumb"
            role="img"
            aria-label="Current header"
            style={{ backgroundImage: `url("${headerImagePath(img.file)}")` }}
          />
        ) : null}
        <p role="status" className="bge-note">
          {imageMessage}
        </p>
        {img ? (
          <div className="bge-imgopts">
            <span className="bge-sub">Place</span>
            <div className="bge-row" role="group" aria-label="Place">
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
              <div className="bge-row" role="group" aria-label="Which shape">
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
            <span className="bge-sub">With the elements</span>
            <div className="bge-row" role="group" aria-label="With the elements">
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
            <span className="bge-sub">Color</span>
            <div className="bge-row" role="group" aria-label="Color">
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
        <div className="bge-row" role="group" aria-label="Fade">
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
