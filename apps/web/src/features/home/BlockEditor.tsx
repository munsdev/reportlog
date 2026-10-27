/**
 * The front page's on-page block editor (mock-up editor.html), for the
 * owner. The page stays as it looks: every block sits where it is, under its
 * own bar (Edit, up, down, Hide, Delete, and a Layout choice), with "+ Add
 * block" between them. The bar's buttons are always at the left.
 *
 * EVERY CHANGE IS SAVED AT ONCE AND IS LIVE. Each action sends the whole
 * list through the blocks call (`setPageBlocks`), and Undo puts back the save
 * before it (twenty are kept, on the server). There is nothing to forget to
 * press; "Done" only leaves the editor.
 *
 * The emergency notice is listed after the headline with Edit alone: its
 * words are their own settings and the box has no place to move to.
 */
import {
  BLOCK_NAMES,
  LIVE_MODULE_NAMES,
  VARIANTS,
  VARIANT_NAMES,
  blockText,
  newBlock,
  setCopy,
  setPageBlocks,
  undoPageBlocks,
} from '@reportlog/contracts';
import type {
  Block,
  BlockType,
  HomeButton,
  LiveModule,
  PageEditorState,
} from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { call } from '@/lib/api.ts';
import { editorQuery } from '../../routes/(staff)/settings/-editor.tsx';
import { pageEditorQuery } from '../pages/queries.ts';
import { AddForm, BlockForm, NoticeForm } from './BlockSheets.tsx';
import { Zone } from './BlockViews.tsx';
import { BlockInside } from './FrontPageBlocks.tsx';
import type { Notice } from './FrontPageBlocks.tsx';
import { HeroBlock } from './HeroBlock.tsx';
import { HelpNow } from '../form/HelpNow.tsx';
import { planBlocks } from './plan.ts';
import { useRefreshLook } from './useRefreshLook.ts';
import type { LiveFacts } from './plan.ts';
import { Sheet } from './Sheet.tsx';

type Open = { kind: 'edit'; id: string } | { kind: 'add'; at: number } | { kind: 'notice' } | null;

const PAGE = { page: 'home' } as const;

export function BlockEditor({
  facts,
  buttons,
  notice,
  onDone,
}: {
  facts: LiveFacts;
  buttons: readonly HomeButton[];
  notice: Notice;
  onDone: () => void;
}) {
  const q = useQuery({ ...pageEditorQuery('home'), refetchOnMount: 'always' });
  // Once open, it stays open: a refetch in the background must not replace
  // what the last save returned.
  const [state, setState] = useState<PageEditorState | null>(null);
  if (q.data && !state) setState(q.data);
  if (!state) {
    return q.isError ? (
      <div className="wrap">
        <p className="note warn" role="alert">
          <span>The front page could not be opened for editing.</span>
        </p>
        <button className="btn sm flat" type="button" onClick={onDone}>
          Back to the page
        </button>
      </div>
    ) : (
      <div className="wrap">
        <p role="status">Opening the editor…</p>
      </div>
    );
  }
  return (
    <Editing
      state={state}
      setState={setState}
      facts={facts}
      buttons={buttons}
      notice={notice}
      onDone={onDone}
    />
  );
}

function Editing({
  state,
  setState,
  facts,
  buttons,
  notice,
  onDone,
}: {
  state: PageEditorState;
  setState: (s: PageEditorState) => void;
  facts: LiveFacts;
  buttons: readonly HomeButton[];
  notice: Notice;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const [status, setStatus] = useState('nothing changed yet');
  const [problem, setProblem] = useState<string | null>(null);

  const arrived = (next: PageEditorState, said: string) => {
    setState(next);
    setStatus(said);
    setProblem(null);
    void client.invalidateQueries({ queryKey: ['page-blocks', 'home'] });
    void client.invalidateQueries({ queryKey: ['page-editor', 'home'] });
  };
  const failed = (e: Error) => {
    setProblem(e.message);
  };

  const save = useMutation({
    mutationFn: (blocks: Block[]) => call(setPageBlocks, { params: PAGE, body: { blocks } }),
    onSuccess: (next) => {
      arrived(next, 'saved just now');
    },
    onError: failed,
  });
  const undo = useMutation({
    mutationFn: () => call(undoPageBlocks, { params: PAGE }),
    onSuccess: (next) => {
      arrived(next, 'undone');
    },
    onError: failed,
  });
  const words = useMutation({
    mutationFn: async (v: { heading: string; text: string; label: string; url: string }) => {
      const keys: [string, string][] = [
        ['cta_heading', v.heading],
        ['help_now', v.text],
        ['cta_button_text', v.label],
        ['cta_button_url', v.url],
      ];
      for (const [key, body] of keys) await call(setCopy, { params: { key }, body: { body } });
    },
    onSuccess: async () => {
      await client.refetchQueries({ queryKey: ['site'] });
      void client.invalidateQueries({ queryKey: editorQuery.queryKey });
      setStatus('saved just now');
      setProblem(null);
    },
    onError: failed,
  });

  const busy = save.isPending || undo.isPending || words.isPending;
  const blocks = state.blocks;
  const put = (next: Block[]) => {
    save.mutate(next);
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...blocks];
    const [b] = next.splice(i, 1);
    if (b) next.splice(i + by, 0, b);
    put(next);
  };
  const change = (id: string, patch: Partial<Block>) => {
    put(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  // The notice's words as written (a {{ figure }} stays a placeholder), not as shown.
  const site = useQuery(editorQuery).data;
  const written = (key: string, shown: string): string =>
    site ? (site.copy.find((c) => c.key === key)?.body ?? shown) : shown;
  const noticeValue = {
    heading: written('cta_heading', notice.heading),
    text: written('help_now', notice.text),
    label: written('cta_button_text', notice.buttonLabel),
    url: written('cta_button_url', notice.buttonUrl),
  };
  const placed = planBlocks(blocks, facts);
  useRefreshLook(
    placed.map((p) => `${p.block.id}${p.block.variant ?? ''}${String(p.shown)}`).join(),
  );
  const editing = open?.kind === 'edit' ? blocks.find((b) => b.id === open.id) : undefined;
  const close = () => {
    setOpen(null);
  };

  return (
    <>
      <div className="admin-bar" role="region" aria-label="Page editor">
        <div className="wrap">
          <span>
            <b style={{ fontFamily: 'var(--rl-font-display)' }}>Editing: Front page</b>{' '}
            <span className="mono" style={{ fontSize: '.75rem', opacity: 0.8 }}>
              · {status} · live
            </span>
          </span>
          <div className="btns">
            <Link className="abtn" to="/home">
              ← Dashboard
            </Link>
            <button
              className="abtn"
              type="button"
              disabled={!state.can_undo || busy}
              onClick={() => {
                undo.mutate();
              }}
            >
              Undo
            </button>
            <button className="abtn" type="button" onClick={onDone}>
              Preview
            </button>
            <button
              className="abtn main"
              type="button"
              onClick={() => {
                window.elSay?.('Saved. The page is live.');
                onDone();
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
      {problem ? (
        <div className="wrap">
          <p className="note warn" role="alert">
            <span>{problem}</span>
          </p>
        </div>
      ) : null}
      <div id="page">
        {placed.map((p, i) => {
          const b = p.block;
          const variants = VARIANTS[b.type as BlockType];
          const badge = !b.shown ? (
            <span className="blk-badge">Hidden from the public</span>
          ) : p.why ? (
            <span className="blk-badge bad">
              Not shown: {p.why.replace(/\.$/, '').toLowerCase()}
            </span>
          ) : null;
          return (
            <div key={b.id}>
              <AddBlock
                onAdd={() => {
                  setOpen({ kind: 'add', at: i });
                }}
              />
              <div
                className={`blk${b.shown ? '' : ' hidden-blk'}${p.why && b.shown ? ' problem' : ''}`}
              >
                <div className="wrap">
                  <div className="blk-bar">
                    <div className="blk-title">
                      <span className="name">
                        {BLOCK_NAMES[b.type as BlockType].name}
                        {b.type === 'live'
                          ? `: ${LIVE_MODULE_NAMES[blockText(b, 'module') as LiveModule]}`
                          : ''}
                      </span>
                      {badge}
                    </div>
                    <div className="blk-tools">
                      <button
                        className="tb"
                        type="button"
                        onClick={() => {
                          setOpen({ kind: 'edit', id: b.id });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="tb"
                        type="button"
                        aria-label="Move up"
                        disabled={i === 0 || busy}
                        onClick={() => {
                          move(i, -1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        className="tb"
                        type="button"
                        aria-label="Move down"
                        disabled={i === blocks.length - 1 || busy}
                        onClick={() => {
                          move(i, 1);
                        }}
                      >
                        ↓
                      </button>
                      <button
                        className="tb"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          change(b.id, { shown: !b.shown });
                        }}
                      >
                        {b.shown ? 'Hide' : 'Show'}
                      </button>
                      <button
                        className="tb"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          put(blocks.filter((x) => x.id !== b.id));
                          window.elSay?.('Block deleted. Undo is in the bar at the top.');
                        }}
                      >
                        Delete
                      </button>
                      {variants.length > 1 ? (
                        <label className="tb sel">
                          <span className="vh">Layout</span>
                          <select
                            value={b.variant}
                            disabled={busy}
                            onChange={(e) => {
                              change(b.id, { variant: e.target.value });
                            }}
                          >
                            {variants.map((v) => (
                              <option key={v} value={v}>
                                {VARIANT_NAMES[v] ?? v}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="blk-body">
                  {b.type === 'hero' ? (
                    <HeroBlock block={b} buttons={buttons} />
                  ) : (
                    <Zone letter={p.zone} tint={false}>
                      <BlockInside block={b} num={p.num} />
                    </Zone>
                  )}
                </div>
              </div>
              {/* The notice follows the headline, as it does on the page. */}
              {b.type === 'hero' && i === placed.findIndex((x) => x.block.type === 'hero') ? (
                <NoticeBlock
                  notice={notice}
                  onEdit={() => {
                    setOpen({ kind: 'notice' });
                  }}
                />
              ) : null}
            </div>
          );
        })}
        <AddBlock
          onAdd={() => {
            setOpen({ kind: 'add', at: blocks.length });
          }}
        />
      </div>
      {open?.kind === 'edit' && editing ? (
        <Sheet title={BLOCK_NAMES[editing.type as BlockType].name} onClose={close}>
          <BlockForm
            block={editing}
            onCancel={close}
            onSave={(fields) => {
              put(blocks.map((b) => (b.id === editing.id ? { ...b, fields } : b)));
              close();
            }}
          />
        </Sheet>
      ) : null}
      {open?.kind === 'add' ? (
        <Sheet title="Add a block" onClose={close}>
          <AddForm
            onCancel={close}
            onAdd={(type) => {
              const fresh = newBlock(type, `b${Date.now().toString(36)}`);
              const at = open.at;
              put([...blocks.slice(0, at), fresh, ...blocks.slice(at)]);
              // Straight on to its words, as the mock-up does.
              setOpen({ kind: 'edit', id: fresh.id });
            }}
          />
        </Sheet>
      ) : null}
      {open?.kind === 'notice' ? (
        <Sheet title="Emergency notice" onClose={close}>
          <NoticeForm
            value={noticeValue}
            onCancel={close}
            onSave={(v) => {
              words.mutate(v);
              close();
            }}
          />
        </Sheet>
      ) : null}
    </>
  );
}

function AddBlock({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="addblk">
      <button type="button" onClick={onAdd}>
        + Add block
      </button>
    </div>
  );
}

/** The emergency notice in the editor: its words, with Edit alone. */
function NoticeBlock({ notice, onEdit }: { notice: Notice; onEdit: () => void }) {
  return (
    <div className="blk">
      <div className="wrap">
        <div className="blk-bar">
          <div className="blk-title">
            <span className="name">Emergency notice</span>
            {!notice.text.trim() ? <span className="blk-badge">Not shown: no words</span> : null}
          </div>
          <div className="blk-tools">
            <button className="tb" type="button" onClick={onEdit}>
              Edit
            </button>
          </div>
        </div>
      </div>
      <div className="blk-body">
        <Zone letter="b">
          <HelpNow
            text={notice.text}
            heading={notice.heading}
            buttonLabel={notice.buttonLabel}
            buttonUrl={notice.buttonUrl}
          />
        </Zone>
      </div>
    </div>
  );
}
