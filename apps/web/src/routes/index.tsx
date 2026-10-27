/**
 * The front page (docs/design/screens/public.md §02). Its shape is
 * features/home/FrontPage.tsx: the name, a big headline, one sentence, the
 * big buttons, a way to About, the emergency notice, and under them the
 * quieter sections in the order an administrator chose.
 *
 * An administrator also gets "Edit this page", which turns the same page
 * into its own editor (features/home/FrontPageEditor.tsx). Nobody else
 * fetches anything an administrator's screen needs: the editor's calls are
 * made only once edit mode is on, and edit mode is offered only to somebody
 * who holds the role, never on a door.
 */
import { blockText, resolveHomeSections } from '@reportlog/contracts';
import type { HomeSectionId } from '@reportlog/contracts';
import { roleSatisfies } from '@reportlog/access';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../components/ui/button.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { ToastProvider, useToast } from '../components/ui/toast.tsx';
import { Lede } from '../components/ui/type.tsx';
import { boardReportsQuery } from '../features/board/queries.ts';
import { HelpNow } from '../features/form/HelpNow.tsx';
import { FALLBACK_BUTTONS, HomeButtons, homeButtonsQuery } from '../features/home/buttons.tsx';
import {
  CheckSection,
  FiguresSection,
  FrontPageLayout,
  HEADLINE_CLASS,
  IntroSection,
  LEDE_CLASS,
  LinksSection,
  MapSection,
  Slogan,
  SocialSection,
} from '../features/home/FrontPage.tsx';
import { FrontPageEditor } from '../features/home/FrontPageEditor.tsx';
import { useGateMode } from '../features/identity/gateMode.ts';
import { useMe } from '../features/identity/session.ts';
import { Markdown } from '../features/pages/Markdown.tsx';
import { HeroEditor } from '../features/pages/HeroEditor.tsx';
import { pageBlocksQuery } from '../features/pages/queries.ts';
import { placedMapsQuery } from '../features/maps/queries.ts';

export const Route = createFileRoute('/')({
  // `?account=deleted`: where deleting your account lands (DeleteAccount.tsx),
  // to say it is done. Anything else is ignored.
  validateSearch: (search: Record<string, unknown>): { account?: 'deleted' } =>
    search.account === 'deleted' ? { account: 'deleted' } : {},
  // Around the whole page rather than the editor, so "Saved" is still on
  // screen after edit mode closes.
  component: () => (
    <ToastProvider>
      <Home />
    </ToastProvider>
  ),
});

/**
 * The owner, and nobody below: the page is the site's face, so changing it
 * on the page is the owner's. (An administrator still edits the same wording
 * from Site settings.) Never on a door, which may not ask who is signed in.
 */
function useCanEdit(): boolean {
  const onDoor = useGateMode() === 'door';
  const me = useMe().data;
  return !onDoor && Boolean(me?.signedIn) && roleSatisfies(me?.signedIn ? me.roles : null, 'owner');
}

function Home() {
  const site = useSite().data;
  const query = useQuery(homeButtonsQuery);
  // The board's own first page: the same request the board makes, so its
  // number is the one the board shows, and it is already there on arrival.
  const board = useQuery(boardReportsQuery({}));
  const published = board.data?.published && 'total' in board.data ? board.data.total : undefined;
  const buttons = query.isError ? FALLBACK_BUTTONS : (query.data?.buttons ?? []);
  const name = plainSiteName(site);
  // The headline block (decision 79), once somebody has saved one; until
  // then the page wording that ships.
  const blocks = useQuery(pageBlocksQuery('home'));
  const hero = blocks.data?.blocks.find((b) => b.type === 'hero');
  const info = hero?.variant === 'info';
  const heroText = (k: string): string => (hero ? blockText(hero, k) : '');
  const headline = heroText('headline') || (site?.copy.home_headline ?? 'ReportLog');
  const lede = hero ? heroText(info ? 'body' : 'line') : (site?.copy.home_lede ?? '');
  const [heroEditing, setHeroEditing] = useState(false);
  const canEdit = useCanEdit();
  const [editing, setEditing] = useState(false);
  const { account } = Route.useSearch();
  const toast = useToast();
  useEffect(() => {
    if (account === 'deleted') toast.show('Your account is deleted, and you are signed out.');
  }, [account, toast]);
  useEffect(() => {
    document.title = `${headline} · ${name}`;
  }, [headline, name]);

  if (editing && canEdit) {
    return (
      <EditMode
        name={name}
        published={published}
        onDone={() => {
          setEditing(false);
        }}
      />
    );
  }

  const intro = site?.copy.home_intro ?? '';
  const drawn: Record<HomeSectionId, ReactNode> = {
    intro: <IntroSection text={intro} />,
    check: <CheckSection />,
    map: <MapSection />,
    figures: <FiguresSection published={published} />,
    links: <LinksSection />,
    social: <SocialSection links={site?.social_links} name={name} />,
  };
  const sections = resolveHomeSections(site?.home_sections)
    .filter((s) => s.shown)
    .map((s) => ({ id: s.id, node: drawn[s.id] }));

  return (
    <FrontPageLayout
      name={name}
      above={
        canEdit ? (
          <>
            {heroEditing ? (
              <HeroEditor
                onDone={() => {
                  setHeroEditing(false);
                }}
              />
            ) : null}
            {/* The owner's edit bar: sticky under the header, its buttons always
              at the left of it (the block editor's rule), so they are found in
              the same place on every page that can be edited. */}
            <div
              role="region"
              aria-label="Page editor"
              data-edit-bar
              className="sticky top-[4.5rem] z-30 flex flex-wrap items-center gap-2 rounded-card border-b-2 border-brand-on-deep bg-deeper px-3 py-2 text-on-deep md:top-20 print:hidden"
            >
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(true);
                }}
              >
                <span aria-hidden="true">✎</span>
                Edit this page
              </Button>
              <Button
                variant="secondary"
                aria-pressed={heroEditing}
                onClick={() => {
                  setHeroEditing((v) => !v);
                }}
              >
                <span aria-hidden="true">✎</span>
                Edit headline
              </Button>
            </div>
          </>
        ) : null
      }
      headline={<h1 className={HEADLINE_CLASS}>{headline}</h1>}
      slogan={<Slogan text={site?.copy.home_slogan ?? ''} />}
      lede={
        lede ? (
          info ? (
            <div className={LEDE_CLASS}>
              <Markdown text={lede} />
            </div>
          ) : (
            <Lede className={LEDE_CLASS}>{lede}</Lede>
          )
        ) : null
      }
      ways={
        query.isPending ? (
          <p role="status">Finding the ways in…</p>
        ) : (
          <HomeButtons buttons={buttons} published={published} siteName={name} quiet={info} />
        )
      }
      helpNow={
        site ? (
          <HelpNow
            text={site.copy.help_now}
            heading={site.copy.cta_heading}
            buttonLabel={site.copy.cta_button_text}
            buttonUrl={site.copy.cta_button_url}
          />
        ) : null
      }
      sections={sections}
    />
  );
}

/** Asks whether a map is placed only once edit mode is on: the view's MapSlot asks for itself. */
function EditMode({
  name,
  published,
  onDone,
}: {
  name: string;
  published: number | undefined;
  onDone: () => void;
}) {
  const placed = useQuery(placedMapsQuery());
  const hasMap = (placed.data?.maps ?? []).some((m) => m.slot === 'home');
  return <FrontPageEditor name={name} published={published} hasMap={hasMap} onDone={onDone} />;
}
