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
import { resolveHomeSections } from '@reportlog/contracts';
import type { HomeSectionId } from '@reportlog/contracts';
import { roleSatisfies } from '@reportlog/access';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../components/ui/button.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { ToastProvider } from '../components/ui/toast.tsx';
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
} from '../features/home/FrontPage.tsx';
import { FrontPageEditor } from '../features/home/FrontPageEditor.tsx';
import { useGateMode } from '../features/identity/gateMode.ts';
import { useMe } from '../features/identity/session.ts';
import { placedMapsQuery } from '../features/maps/queries.ts';

export const Route = createFileRoute('/')({
  // Around the whole page rather than the editor, so "Saved" is still on
  // screen after edit mode closes.
  component: () => (
    <ToastProvider>
      <Home />
    </ToastProvider>
  ),
});

/** Whoever may change the site's settings: the people `/settings` lets in. */
function useCanEdit(): boolean {
  const onDoor = useGateMode() === 'door';
  const me = useMe().data;
  return !onDoor && Boolean(me?.signedIn) && roleSatisfies(me?.signedIn ? me.role : null, 'admin');
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
  const headline = site?.copy.home_headline ?? 'ReportLog';
  const canEdit = useCanEdit();
  const [editing, setEditing] = useState(false);
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
  };
  const sections = resolveHomeSections(site?.home_sections)
    .filter((s) => s.shown)
    .map((s) => ({ id: s.id, node: drawn[s.id] }));

  return (
    <FrontPageLayout
      name={name}
      above={
        canEdit ? (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit this page
            </Button>
          </div>
        ) : null
      }
      headline={<h1 className={HEADLINE_CLASS}>{headline}</h1>}
      lede={site?.copy.home_lede ? <Lede className={LEDE_CLASS}>{site.copy.home_lede}</Lede> : null}
      ways={
        query.isPending ? (
          <p role="status">Finding the ways in…</p>
        ) : (
          <HomeButtons buttons={buttons} published={published} />
        )
      }
      helpNow={site ? <HelpNow text={site.copy.help_now} /> : null}
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
