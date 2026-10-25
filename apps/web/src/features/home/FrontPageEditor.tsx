/**
 * The front page in edit mode, for an administrator (decided 22 October
 * 2026, bringing back the old app's on-page editor that decisions 27 and 61
 * had moved into forms).
 *
 * THE PAGE STAYS AS IT LOOKS. Each piece an operator owns becomes editable
 * where it sits: the headline, the lede, the introduction, the emergency
 * notice's wording, each button's wording and place, and which quieter
 * sections show and in what order. The judgement being made is "does this
 * page read right", and that does not survive being made in a form on
 * another screen.
 *
 * NOTHING IS PUBLIC UNTIL SAVE. Every change is held here, and Save sends
 * them through the same calls the settings screens use (`setCopy`,
 * `setHomeButtons`, `setHomeSections`), so the server's checks are the ones
 * that already apply: a built-in button cannot be relabelled, and the
 * emergency notice saved empty goes back to its shipped wording rather than
 * disappearing (decision 62).
 *
 * The raw wording comes from the settings editor's state, not the public
 * page's, so a {{ figure }} is edited as written rather than as the number
 * it shows today.
 */
import {
  setCopy,
  setHomeButtons,
  setHomeSections,
  shownSocialLinks,
  HOME_SECTION_NAMES,
} from '@reportlog/contracts';
import type {
  AvailableButton,
  CopyKey,
  HomeButtonsAdmin,
  HomeSection,
  HomeSectionId,
  SiteEditor,
} from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { SaveBar } from '@/components/ui/save-bar.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { homeButtonsAdminQuery } from '@/features/builder/queries.ts';
import { call } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';
import {
  UnsavedChangesGuard,
  editorQuery,
  useUnsavedChanges,
} from '../../routes/(staff)/settings/-editor.tsx';
import { BIG_BUTTON } from './buttons.tsx';
import {
  CheckSection,
  FiguresSection,
  FrontPageLayout,
  HEADLINE_CLASS,
  LEDE_CLASS,
  LinksSection,
  MapSection,
  SocialSection,
} from './FrontPage.tsx';

/** The wording slots that are on the front page. */
const KEYS = ['home_headline', 'home_lede', 'home_intro', 'help_now'] as const;
type FrontKey = (typeof KEYS)[number] & CopyKey;
type Copy = Record<FrontKey, string>;

/** A button as the editor holds it: which one, and its own wording or ''. */
interface Row {
  kind: AvailableButton['kind'];
  ref: string;
  label: string;
}

const rowsFrom = (data: HomeButtonsAdmin): Row[] =>
  data.buttons.map((b) => ({
    kind: b.kind,
    ref: b.ref,
    label: b.label === b.title ? '' : b.label,
  }));

const keyOf = (r: { kind: string; ref: string }) => `${r.kind}:${r.ref}`;

export function FrontPageEditor({
  name,
  published,
  hasMap,
  onDone,
}: {
  name: string;
  published: number | undefined;
  hasMap: boolean;
  onDone: () => void;
}) {
  // Asked afresh every time edit mode opens: the editor starts from what
  // the server holds now, not from an answer cached on an earlier visit.
  const editor = useQuery({ ...editorQuery, refetchOnMount: 'always' });
  const buttons = useQuery({ ...homeButtonsAdminQuery(), refetchOnMount: 'always' });
  // Once open, it stays open: a refetch in the background (the window
  // regaining focus, say) must not throw away what is being typed.
  const [ready, setReady] = useState(false);
  const fresh = editor.isSuccess && buttons.isSuccess && !editor.isFetching && !buttons.isFetching;
  // Set while rendering, React's way of keeping state that follows other state.
  if (fresh && !ready) setReady(true);
  if (!ready && (editor.isError || buttons.isError)) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="serious" title="The front page could not be opened for editing.">
          {(editor.error ?? buttons.error)?.message}
        </Alert>
        <div>
          <Button variant="secondary" onClick={onDone}>
            Back to the page
          </Button>
        </div>
      </div>
    );
  }
  if (!ready || !editor.data || !buttons.data) {
    return <p role="status">Opening the front page for editing…</p>;
  }
  return (
    <UnsavedChangesGuard>
      <Editing
        name={name}
        published={published}
        hasMap={hasMap}
        editor={editor.data}
        buttons={buttons.data}
        onDone={onDone}
      />
    </UnsavedChangesGuard>
  );
}

function Editing({
  name,
  published,
  hasMap,
  editor,
  buttons,
  onDone,
}: {
  name: string;
  published: number | undefined;
  hasMap: boolean;
  editor: SiteEditor;
  buttons: HomeButtonsAdmin;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  // What the server holds now, which is what every change is measured from.
  const [start] = useState(() => ({
    copy: Object.fromEntries(
      KEYS.map((k) => [k, editor.copy.find((c) => c.key === k)?.body ?? '']),
    ) as Copy,
    rows: rowsFrom(buttons),
    sections: editor.home_sections,
  }));
  const [copy, setCopyDraft] = useState<Copy>(start.copy);
  const [rows, setRows] = useState<Row[]>(start.rows);
  const [sections, setSections] = useState<HomeSection[]>(start.sections);

  const copyChanged = KEYS.filter((k) => copy[k] !== start.copy[k]);
  const rowsChanged = JSON.stringify(rows) !== JSON.stringify(start.rows);
  const sectionsChanged = JSON.stringify(sections) !== JSON.stringify(start.sections);
  const dirty = copyChanged.length > 0 || rowsChanged || sectionsChanged;
  useUnsavedChanges('the front page', dirty);

  /** The page as the server now has it, waited for, so what shows next is the saved page. */
  const refresh = () =>
    Promise.all([
      client.refetchQueries({ queryKey: ['site'] }),
      client.refetchQueries({ queryKey: ['home-buttons'] }),
      client.invalidateQueries({ queryKey: editorQuery.queryKey }),
      client.invalidateQueries({ queryKey: homeButtonsAdminQuery().queryKey }),
    ]);

  const save = useMutation({
    // One call after another, each through the route its own settings
    // screen uses. A refusal stops the rest and is shown; what was saved
    // before it stays saved, and the page is refetched either way.
    mutationFn: async () => {
      for (const key of copyChanged) {
        await call(setCopy, { params: { key }, body: { body: copy[key] } });
      }
      if (rowsChanged) {
        await call(setHomeButtons, {
          body: {
            order: [
              ...rows.map((r) =>
                r.label.trim()
                  ? { kind: r.kind, ref: r.ref, label: r.label.trim() }
                  : { kind: r.kind, ref: r.ref },
              ),
              // HIDDEN, SAID SO. Left out, a logbook or list is "new" to the
              // server and is added back to the end of the page.
              ...hiddenButtons
                .filter((b) => b.kind !== 'builtin')
                .map((b) => ({ kind: b.kind, ref: b.ref, hidden: true as const })),
            ],
          },
        });
      }
      if (sectionsChanged) await call(setHomeSections, { body: { sections } });
      // Before edit mode closes, so the page it closes onto is the saved one
      // rather than the old one for a moment.
      await refresh();
    },
    onError: () => {
      void refresh();
    },
    onSuccess: () => {
      toast.show('Saved. The front page shows it now.');
      onDone();
    },
  });

  const cancel = () => {
    if (save.isPending) return;
    if (dirty && !window.confirm('Throw away your changes to the front page?')) return;
    onDone();
  };

  const word = (key: FrontKey) => (value: string) => {
    setCopyDraft((now) => ({ ...now, [key]: value }));
  };

  // ── the buttons ──
  const all: AvailableButton[] = [
    ...buttons.available.logbooks,
    ...buttons.available.lists,
    ...buttons.available.builtins,
  ];
  const find = (r: Row) => all.find((b) => keyOf(b) === keyOf(r));
  const moveRow = (i: number, by: -1 | 1) => {
    setRows((now) => {
      const next = [...now];
      const [r] = next.splice(i, 1);
      if (r) next.splice(i + by, 0, r);
      return next;
    });
  };
  const hiddenButtons = all.filter((b) => !rows.some((r) => keyOf(r) === keyOf(b)));

  // ── the sections ──
  const moveSection = (i: number, by: -1 | 1) => {
    setSections((now) => {
      const next = [...now];
      const [s] = next.splice(i, 1);
      if (s) next.splice(i + by, 0, s);
      return next;
    });
  };
  const toggleSection = (id: HomeSectionId) => {
    setSections((now) => now.map((s) => (s.id === id ? { ...s, shown: !s.shown } : s)));
  };
  const sectionBody = (id: HomeSectionId): ReactNode => {
    switch (id) {
      case 'intro':
        return (
          <Wording
            label={labelOf(editor, 'home_intro')}
            value={copy.home_intro}
            onChange={word('home_intro')}
            rows={5}
          />
        );
      case 'check':
        return <CheckSection />;
      case 'map':
        return hasMap ? (
          <MapSection />
        ) : (
          <Note>No map is placed on the front page. Maps are placed under Maps.</Note>
        );
      case 'figures':
        return published === undefined ? (
          <Note>Shown once the archive is public: until then there is nothing to count.</Note>
        ) : (
          <FiguresSection published={published} />
        );
      case 'links':
        return <LinksSection />;
      case 'social': {
        const links = shownSocialLinks(editor.social_links);
        return links.length ? (
          <SocialSection links={links} name={name} />
        ) : (
          <Note>
            No social media account is switched on. Accounts are added under Site, Social media.
          </Note>
        );
      }
    }
  };

  return (
    <>
      <FrontPageLayout
        name={name}
        above={
          <div className="flex flex-col gap-3">
            <Alert tone="note" title="You are editing the front page.">
              Change anything with a dashed line round it. Nobody else sees your changes until you
              press Save at the bottom of the screen.
            </Alert>
            {save.isError ? (
              <Alert tone="serious" title="That was not all saved.">
                {save.error.message}
              </Alert>
            ) : null}
          </div>
        }
        headline={
          <Editable>
            <Field>
              <Label className="label-face text-xs">{labelOf(editor, 'home_headline')}</Label>
              <Input
                className={cn(HEADLINE_CLASS, 'h-auto py-1')}
                value={copy.home_headline}
                maxLength={300}
                onChange={(e) => {
                  word('home_headline')(e.target.value);
                }}
              />
              <EmptyHint value={copy.home_headline} />
            </Field>
          </Editable>
        }
        lede={
          <Wording
            label={labelOf(editor, 'home_lede')}
            value={copy.home_lede}
            onChange={word('home_lede')}
            rows={2}
            className={LEDE_CLASS}
            hint="Keep it to one short sentence: what this site is."
          />
        }
        ways={
          <div className="flex flex-col gap-4">
            <ol aria-label="The buttons, in order" className="flex flex-col gap-4">
              {rows.map((r, i) => {
                const b = find(r);
                const title = b?.label ?? r.ref;
                const shown = r.label.trim() || title;
                return (
                  <li key={keyOf(r)}>
                    <Editable className="flex flex-col gap-3">
                      {/* The button as it will look: a picture, the controls under it say it in words. */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          buttonVariants({
                            variant: i === 0 ? 'primary' : 'secondary',
                            size: 'lg',
                            block: true,
                          }),
                          BIG_BUTTON,
                          'shadow-none active:transform-none',
                        )}
                      >
                        {shown}
                      </span>
                      {r.kind === 'builtin' ? (
                        <p className="text-sm text-ink-alt">
                          “{title}” is part of the site, so its wording stays: it always says what
                          it does.
                        </p>
                      ) : (
                        <Field>
                          <Label>Wording on “{title}”</Label>
                          <Input
                            value={r.label}
                            maxLength={80}
                            placeholder={title}
                            onChange={(e) => {
                              const label = e.target.value;
                              setRows((now) => now.map((x, j) => (j === i ? { ...x, label } : x)));
                            }}
                          />
                          <FieldDescription>
                            {`Left empty, the button says the ${r.kind === 'list' ? 'list' : 'logbook'}’s own title.`}
                          </FieldDescription>
                        </Field>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          disabled={i === 0}
                          aria-label={`Move up: “${shown}”`}
                          onClick={() => {
                            moveRow(i, -1);
                          }}
                        >
                          Move up
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={i === rows.length - 1}
                          aria-label={`Move down: “${shown}”`}
                          onClick={() => {
                            moveRow(i, 1);
                          }}
                        >
                          Move down
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label={`Hide: “${shown}”`}
                          onClick={() => {
                            setRows((now) => now.filter((_, j) => j !== i));
                          }}
                        >
                          Hide
                        </Button>
                      </div>
                      {i === 0 ? (
                        <p className="text-sm text-ink-alt">
                          The first button is the main one. To make another the main one, move it to
                          the top.
                        </p>
                      ) : null}
                    </Editable>
                  </li>
                );
              })}
            </ol>
            {rows.length === 0 ? (
              <Note>No buttons. Open logbooks are still added to the page.</Note>
            ) : null}
            {hiddenButtons.length ? (
              <section
                aria-label="Buttons not on the front page"
                className="flex flex-col gap-2 rounded-card border-2 border-dashed border-ink-alt p-3"
              >
                <h2 className="label-face text-xs">Not on the front page</h2>
                <ul className="flex flex-col gap-2">
                  {hiddenButtons.map((b) => (
                    <li
                      key={keyOf(b)}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>{b.label}</span>
                      <Button
                        variant="secondary"
                        aria-label={`Show: “${b.label}”`}
                        onClick={() => {
                          setRows((now) => [...now, { kind: b.kind, ref: b.ref, label: '' }]);
                        }}
                      >
                        Show it
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        }
        helpNow={
          <Card variant="deep" className="gap-2">
            <h2 className="label-face text-sm text-brand-on-deep">
              If someone needs help right now
            </h2>
            <Field>
              <Label className="text-on-deep">{labelOf(editor, 'help_now')}</Label>
              <Textarea
                rows={3}
                value={copy.help_now}
                onChange={(e) => {
                  word('help_now')(e.target.value);
                }}
              />
              <FieldDescription className="text-on-deep">
                You can reword this notice; you cannot remove it. Left empty, the wording it shipped
                with comes back.
              </FieldDescription>
            </Field>
          </Card>
        }
        sections={sections.map((s, i) => ({
          id: s.id,
          node: (
            <Editable className={cn('flex flex-col gap-3', !s.shown && 'bg-paper-alt')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="label-face text-xs">
                  {HOME_SECTION_NAMES[s.id]}
                  {s.shown ? '' : ' · hidden from visitors'}
                </h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={i === 0}
                    aria-label={`Move up: ${HOME_SECTION_NAMES[s.id]}`}
                    onClick={() => {
                      moveSection(i, -1);
                    }}
                  >
                    Move up
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={i === sections.length - 1}
                    aria-label={`Move down: ${HOME_SECTION_NAMES[s.id]}`}
                    onClick={() => {
                      moveSection(i, 1);
                    }}
                  >
                    Move down
                  </Button>
                  <Button
                    variant="secondary"
                    aria-pressed={!s.shown}
                    aria-label={`${s.shown ? 'Hide' : 'Show'}: ${HOME_SECTION_NAMES[s.id]}`}
                    onClick={() => {
                      toggleSection(s.id);
                    }}
                  >
                    {s.shown ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </div>
              <div className={cn(!s.shown && 'opacity-60')}>{sectionBody(s.id)}</div>
            </Editable>
          ),
        }))}
      />
      <SaveBar
        lead=""
        name="Editing the front page"
        busy={save.isPending}
        onSave={() => {
          save.mutate();
        }}
        onCancel={cancel}
      />
    </>
  );
}

const labelOf = (editor: SiteEditor, key: FrontKey): string =>
  editor.copy.find((c) => c.key === key)?.label ?? key;

/** The dashed line that says "this can be changed". */
function Editable({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-card border-2 border-dashed border-ink-alt p-3', className)}>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-alt">{children}</p>;
}

function EmptyHint({ value }: { value: string }) {
  return value.trim() ? null : (
    <FieldDescription>Left empty, the wording it shipped with comes back.</FieldDescription>
  );
}

function Wording({
  label,
  value,
  onChange,
  rows,
  className,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  className?: string;
  hint?: string;
}) {
  return (
    <Editable>
      <Field>
        <Label className="label-face text-xs">{label}</Label>
        <Textarea
          rows={rows}
          className={className}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
        {hint && value.trim() ? <FieldDescription>{hint}</FieldDescription> : null}
        <EmptyHint value={value} />
      </Field>
    </Editable>
  );
}
