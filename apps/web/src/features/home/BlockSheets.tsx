/**
 * The forms inside the editor's sheet, one for each kind of block, in the
 * mock-up's markup (the mock-up's block editor). Each edits a copy; Save hands
 * the whole set of fields back, Cancel throws the copy away. What a field is
 * called, what its help says and how many entries it takes are the mock-up's.
 *
 * A destination is chosen from what the site has (its logbooks, lists, maps
 * and pages), never typed, unless "A web address" is chosen: that is the
 * mock-up's rule too.
 */
import {
  BLOCK_NAMES,
  BLOCK_TYPES,
  LIVE_MODULES,
  LIVE_MODULE_NAMES,
  blockItems,
} from '@reportlog/contracts';
import type { Block, BlockType, Item } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { homeButtonsAdminQuery } from '../builder/queries.ts';

// ── small pieces ────────────────────────────────────────────────────────

function Fld({
  label,
  value,
  onChange,
  help,
  area = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: ReactNode;
  area?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {area ? (
        <textarea
          className="textarea"
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      ) : (
        <input
          className="input"
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      )}
      {help ? <span className="help">{help}</span> : null}
    </div>
  );
}

interface Target {
  href: string;
  label: string;
  why: string | null;
}

/** What a button or card may lead to, from the site itself, in the mock-up's groups. */
function useDestinations(): { group: string; items: Target[] }[] {
  const q = useQuery(homeButtonsAdminQuery());
  const targets = q.data?.targets ?? [];
  const of = (kind: string): Target[] =>
    targets.flatMap((t) =>
      t.kind === kind && t.href
        ? [{ href: t.href, label: t.label, why: t.showing ? null : t.why_not }]
        : [],
    );
  const pages: Target[] = [
    { href: '/board', label: 'Reports', why: null },
    { href: '/about', label: 'About', why: null },
    { href: '/get-involved', label: 'Get involved', why: null },
    { href: '/journalists', label: 'For journalists', why: null },
    { href: '/how', label: 'How it works', why: null },
    { href: '/verify', label: 'Check a report', why: null },
  ];
  return [
    { group: 'Logbooks', items: of('logbook') },
    { group: 'Lists', items: of('list') },
    { group: 'Maps', items: of('map') },
    { group: 'Pages', items: pages },
  ].filter((g) => g.items.length);
}

const WEB = '__web';

function Dest({
  label,
  value,
  onChange,
  small = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  small?: boolean;
}) {
  const id = useId();
  const groups = useDestinations();
  const found = groups.flatMap((g) => g.items).find((i) => i.href === value);
  const [web, setWeb] = useState(value !== '' && !found);
  const select = (
    <select
      className="sel"
      id={id}
      {...(small ? { 'aria-label': label } : {})}
      value={web ? WEB : value}
      onChange={(e) => {
        if (e.target.value === WEB) {
          setWeb(true);
          if (found) onChange('');
        } else {
          setWeb(false);
          onChange(e.target.value);
        }
      }}
    >
      <option value="">Nowhere (hides the button)</option>
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.items.map((i) => (
            <option key={i.href} value={i.href}>
              {i.label}
              {i.why ? ` (${i.why})` : ''}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="Other">
        <option value={WEB}>A web address</option>
      </optgroup>
    </select>
  );
  const address = web ? (
    <input
      className="input"
      aria-label="Web address"
      placeholder="https://"
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  ) : null;
  if (small)
    return (
      <>
        {select}
        {address}
      </>
    );
  return (
    <div className="field dest">
      <label htmlFor={id}>{label}</label>
      {select}
      {address}
      {found?.why ? (
        <span className="why">
          This target is {found.why}. The button stays hidden until it opens.
        </span>
      ) : (
        <span className="help">
          Pick what the button leads to. Addresses and names come from the target itself.
        </span>
      )}
    </div>
  );
}

function Items({
  items,
  onChange,
  cards,
  withTag,
  max,
}: {
  items: Item[];
  onChange: (next: Item[]) => void;
  cards: boolean;
  /** Steps and cards may carry a small line: a stamp, or the line above a card. */
  withTag: boolean;
  max: number;
}) {
  const put = (i: number, patch: Partial<Item>) => {
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  };
  return (
    <div className="field">
      <span className="lbl">{cards ? 'Cards' : 'Steps (2 to 5)'}</span>
      <div className="items">
        {items.map((it, i) => (
          <div className="item" key={i}>
            <input
              className="input"
              placeholder="Title"
              aria-label={`Title, ${cards ? 'card' : 'step'} ${String(i + 1)}`}
              value={it.title}
              onChange={(e) => {
                put(i, { title: e.target.value });
              }}
            />
            <input
              className="input"
              placeholder="One line"
              aria-label={`One line, ${cards ? 'card' : 'step'} ${String(i + 1)}`}
              value={it.line}
              onChange={(e) => {
                put(i, { line: e.target.value });
              }}
            />
            {withTag ? (
              <input
                className="input"
                placeholder={cards ? 'Small line above (optional)' : 'Stamp (optional)'}
                aria-label={`${cards ? 'Small line above' : 'Stamp'}, ${cards ? 'card' : 'step'} ${String(i + 1)}`}
                value={it.tag}
                onChange={(e) => {
                  put(i, { tag: e.target.value });
                }}
              />
            ) : null}
            {cards ? (
              <>
                <Dest
                  small
                  label={`Leads to, card ${String(i + 1)}`}
                  value={it.link}
                  onChange={(v) => {
                    put(i, { link: v });
                  }}
                />
                <input
                  className="input"
                  placeholder="Button text"
                  aria-label={`Button text, card ${String(i + 1)}`}
                  value={it.label}
                  onChange={(e) => {
                    put(i, { label: e.target.value });
                  }}
                />
              </>
            ) : null}
            <div className="row">
              <button
                className="tb"
                type="button"
                onClick={() => {
                  onChange(items.filter((_, j) => j !== i));
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      {items.length < max ? (
        <button
          className="tb"
          type="button"
          onClick={() => {
            onChange([...items, { title: '', line: '', link: '', tag: '', label: '' }]);
          }}
        >
          + Add
        </button>
      ) : null}
    </div>
  );
}

function SaveRow({ onCancel, saveLabel = 'Save' }: { onCancel: () => void; saveLabel?: string }) {
  return (
    <div className="btn-row">
      <button className="btn sm flat" type="button" onClick={onCancel}>
        Cancel
      </button>
      <button className="btn sm flat go" type="submit">
        {saveLabel}
      </button>
    </div>
  );
}

// ── the forms ───────────────────────────────────────────────────────────

type Fields = Record<string, unknown>;
const text = (f: Fields, k: string): string => (typeof f[k] === 'string' ? f[k] : '');

export function BlockForm({
  block,
  onSave,
  onCancel,
}: {
  block: Block;
  onSave: (fields: Fields) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<Fields>(block.fields);
  const [items, setItems] = useState<Item[]>(() =>
    block.type === 'steps' || block.type === 'cards' ? blockItems(block) : [],
  );
  const set = (k: string) => (v: string) => {
    setF((now) => ({ ...now, [k]: v }));
  };
  const t = (k: string) => text(f, k);
  const cards = block.type === 'cards';
  const submit = () => {
    if (block.type === 'steps' || block.type === 'cards') {
      onSave({
        ...f,
        items: items
          .map((i) => ({ ...i, title: i.title.trim() }))
          .filter((i) => i.title)
          .slice(0, cards ? 12 : 5),
      });
    } else onSave(f);
  };

  let body: ReactNode = null;
  if (block.type === 'hero') {
    const info = block.variant === 'info';
    body = (
      <>
        <Fld label="Small line above" value={t('eyebrow')} onChange={set('eyebrow')} />
        <Fld label="Headline, first line" value={t('headline')} onChange={set('headline')} />
        <Fld
          label="Headline, second line"
          value={t('headline2')}
          onChange={set('headline2')}
          help="Drawn in outline in the Poster layout."
        />
        <Fld
          label="Slogan"
          value={t('slogan')}
          onChange={set('slogan')}
          help="Shown as a bar under the headline. Empty hides it."
        />
        <Fld
          label="Introduction"
          area
          value={info ? t('body') : t('line')}
          onChange={set(info ? 'body' : 'line')}
          help={info ? 'Markdown: paragraphs, **bold**, [links](/page).' : undefined}
        />
        <div className="field">
          <span className="lbl">Buttons</span>
          <Link className="btn sm flat" to="/logbooks/front-page" style={{ justifySelf: 'start' }}>
            Arrange the buttons
          </Link>
          <span className="help">
            The first is the main one. They are the front page buttons, set on their own screen.
          </span>
        </div>
        <Fld label="Line under the buttons" value={t('who')} onChange={set('who')} />
        {/* Always offered, and to the Look screen, where the header background
            is saved for the whole site. It used to show only once the floating
            Look panel had been built, which was usually after this sheet drew. */}
        <div className="field">
          <span className="lbl">Background</span>
          <Link
            className="btn sm flat"
            to="/settings/look"
            hash="look-bg"
            style={{ justifySelf: 'start' }}
          >
            Edit header background
          </Link>
          <span className="help">Elements, image, fade. Applies to every page header.</span>
        </div>
      </>
    );
  } else if (block.type === 'cta') {
    body = (
      <>
        <Fld label="Small line above" value={t('mark')} onChange={set('mark')} />
        <Fld label="Heading" value={t('heading')} onChange={set('heading')} />
        <Fld
          label="Text"
          area
          value={t('text')}
          onChange={set('text')}
          help="Saved empty, the box does not show."
        />
        <h3 className="lbl">Optional button</h3>
        <Dest label="Leads to" value={t('url')} onChange={set('url')} />
        <Fld label="Button text" value={t('label')} onChange={set('label')} />
      </>
    );
  } else if (block.type === 'text') {
    body = (
      <>
        <Fld label="Heading" value={t('heading')} onChange={set('heading')} />
        <Fld
          label="Body"
          area
          value={t('body')}
          onChange={set('body')}
          help={
            block.variant === 'statement'
              ? 'The first paragraph is the big sentence (**bold** is highlighted). A paragraph that is only a [link](/page) becomes a button. No HTML.'
              : 'Markdown: paragraphs, ## headings, **bold**, [links](/page). No HTML.'
          }
        />
      </>
    );
  } else if (block.type === 'steps' || block.type === 'cards') {
    body = (
      <>
        <Fld label="Heading" value={t('heading')} onChange={set('heading')} />
        <Items items={items} onChange={setItems} cards={cards} withTag max={cards ? 12 : 5} />
      </>
    );
  } else {
    body = (
      <>
        <div className="field">
          <label htmlFor="f-module">Which part</label>
          <select
            className="sel"
            id="f-module"
            value={t('module')}
            onChange={(e) => {
              set('module')(e.target.value);
            }}
          >
            {LIVE_MODULES.map((m) => (
              <option key={m} value={m}>
                {LIVE_MODULE_NAMES[m]}
              </option>
            ))}
          </select>
          <span className="help">
            Live parts fetch their own data. The map and the figures hide themselves while there is
            nothing to show.
          </span>
        </div>
        <Fld
          label="Heading"
          value={t('heading')}
          onChange={set('heading')}
          help="Empty is the part's own name."
        />
        <Fld
          label="Line under the heading"
          value={t('line')}
          onChange={set('line')}
          help="Empty is the part's own line."
        />
      </>
    );
  }
  return (
    <form
      style={{ display: 'contents' }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {body}
      <SaveRow onCancel={onCancel} />
    </form>
  );
}

/** "Add a block": the kinds, as the mock-up's radio rows. */
export function AddForm({
  onAdd,
  onCancel,
}: {
  onAdd: (type: BlockType) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<BlockType>('text');
  return (
    <form
      style={{ display: 'contents' }}
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(type);
      }}
    >
      <div className="choices">
        {BLOCK_TYPES.map((t) => (
          <label className="choice" key={t}>
            <input
              type="radio"
              name="nt"
              value={t}
              checked={type === t}
              onChange={() => {
                setType(t);
              }}
            />
            <span className="dot" aria-hidden="true"></span>
            {BLOCK_NAMES[t].name}
          </label>
        ))}
      </div>
      <SaveRow onCancel={onCancel} saveLabel="Add" />
    </form>
  );
}

/** The emergency notice's own words (the help_now and call to action slots; saved empty, the box does not show, decision 78). */
export function NoticeForm({
  value,
  onSave,
  onCancel,
}: {
  value: { heading: string; text: string; label: string; url: string };
  onSave: (v: { heading: string; text: string; label: string; url: string }) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(value);
  const set = (k: keyof typeof v) => (x: string) => {
    setV((now) => ({ ...now, [k]: x }));
  };
  return (
    <form
      style={{ display: 'contents' }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
    >
      <Fld
        label="Heading"
        value={v.heading}
        onChange={set('heading')}
        help="Left empty, the shipped heading comes back."
      />
      <Fld
        label="Text"
        area
        value={v.text}
        onChange={set('text')}
        help="Under the heading. Saved empty, the box does not show."
      />
      <h3 className="lbl">Optional button</h3>
      <Dest label="Leads to" value={v.url} onChange={set('url')} />
      <Fld label="Button text" value={v.label} onChange={set('label')} />
      <SaveRow onCancel={onCancel} />
    </form>
  );
}
