/**
 * The front page (mock-up index.html): a headline, the Follow along band, the
 * emergency notice and the owner's zones, each a block of the page (the
 * headline, How it works, What people are reporting, Who is behind it, Get
 * involved, More you can do ...). The words and the arrangement are the
 * owner's, edited on the page itself (features/home/BlockEditor.tsx), and
 * until anything is saved they are what the site's settings say: the wording
 * slots and the sections an administrator arranged (apps/api/src/pages).
 *
 * The owner gets an "Edit this page" bar at the top; the editor is this same
 * address with `?edit=true`. Nobody else fetches anything an editor needs:
 * the editor's calls are made only once edit mode is on, and edit mode is
 * offered only to somebody who holds the role, never on a door.
 */
import { blockText, newBlock } from '@reportlog/contracts';
import { roleSatisfies } from '@reportlog/access';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { ToastProvider, useToast } from '../components/ui/toast.tsx';
import { boardReportsQuery } from '../features/board/queries.ts';
import { BlockEditor } from '../features/home/BlockEditor.tsx';
import { FALLBACK_BUTTONS, homeButtonsQuery } from '../features/home/buttons.tsx';
import { FrontPageBlocks } from '../features/home/FrontPageBlocks.tsx';
import type { Notice } from '../features/home/FrontPageBlocks.tsx';
import { planBlocks } from '../features/home/plan.ts';
import type { LiveFacts } from '../features/home/plan.ts';
import { useGateMode } from '../features/identity/gateMode.ts';
import { useMe } from '../features/identity/session.ts';
import { pageBlocksQuery } from '../features/pages/queries.ts';
import { placedMapsQuery } from '../features/maps/queries.ts';
import { DockSlot } from '../mockup/Dock.tsx';
import { useBodyClass } from '../mockup/useBodyClass.ts';

interface FrontSearch {
  account?: 'deleted';
  edit?: true;
}

export const Route = createFileRoute('/')({
  // `?account=deleted`: where deleting your account lands (DeleteAccount.tsx),
  // to say it is done. `?edit=true`: the owner's editor. Anything else is ignored.
  validateSearch: (search: Record<string, unknown>): FrontSearch => ({
    ...(search.account === 'deleted' ? { account: 'deleted' as const } : {}),
    ...(search.edit === true || search.edit === 'true' ? { edit: true as const } : {}),
  }),
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
 * on the page is the owner's. Never on a door, which may not ask who is
 * signed in.
 */
function useCanEdit(): boolean {
  const onDoor = useGateMode() === 'door';
  const me = useMe().data;
  return !onDoor && Boolean(me?.signedIn) && roleSatisfies(me?.signedIn ? me.roles : null, 'owner');
}

function Home() {
  useBodyClass('dark');
  const site = useSite().data;
  const navigate = useNavigate();
  const { account, edit } = Route.useSearch();
  const toast = useToast();
  const canEdit = useCanEdit();
  const buttonsQuery = useQuery(homeButtonsQuery);
  const buttons = buttonsQuery.isError ? FALLBACK_BUTTONS : (buttonsQuery.data?.buttons ?? []);
  // The board's own first page: the same request the board makes, so its
  // number is the one the board shows, and it is already there on arrival.
  const board = useQuery(boardReportsQuery({}));
  const published = board.data?.published && 'total' in board.data ? board.data.total : undefined;
  const maps = useQuery(placedMapsQuery());
  const hasMap = (maps.data?.maps ?? []).some(
    (m) => m.slot === 'home' || m.also_slots.includes('home'),
  );
  const facts: LiveFacts = {
    published,
    hasMap,
    hasAccounts: (site?.social_links?.length ?? 0) > 0,
  };
  const page = useQuery(pageBlocksQuery('home'));
  const name = plainSiteName(site);

  // Never a page without a headline: if the blocks cannot be read, the
  // site's own wording stands in.
  const blocks = page.data?.blocks ?? (page.isError ? [fallbackHero(site?.copy)] : []);
  const placed = planBlocks(blocks, facts);
  const hero = blocks.find((b) => b.type === 'hero');
  const headline = (hero ? blockText(hero, 'headline') : '') || (site?.copy.home_headline ?? name);

  useEffect(() => {
    document.title = `${headline} · ${name}`;
  }, [headline, name]);
  useEffect(() => {
    if (account === 'deleted') toast.show('Your account is deleted, and you are signed out.');
  }, [account, toast]);

  const notice: Notice | null = site
    ? {
        text: site.copy.help_now,
        heading: site.copy.cta_heading,
        buttonLabel: site.copy.cta_button_text,
        buttonUrl: site.copy.cta_button_url,
      }
    : null;

  if (edit && canEdit && notice) {
    return (
      <BlockEditor
        facts={facts}
        buttons={buttons}
        notice={notice}
        onDone={() => {
          void navigate({ to: '/', search: {} });
        }}
      />
    );
  }
  if (!page.data && !page.isError) return <div data-bleed />;
  return (
    <>
      {canEdit ? (
        <DockSlot slot="fab-edit">
          {/* Only the owner and administrators see it (the old bar said so). */}
          <button
            className="lookfab dock-pill"
            type="button"
            onClick={() => {
              void navigate({ to: '/', search: { edit: true } });
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
              />
            </svg>
            <span>Edit this page</span>
          </button>
        </DockSlot>
      ) : null}
      <FrontPageBlocks placed={placed} buttons={buttons} notice={notice} />
    </>
  );
}

function fallbackHero(copy: Record<string, string> | undefined) {
  const b = newBlock('hero', 'hero');
  b.variant = 'poster';
  b.fields = {
    ...b.fields,
    headline: copy?.home_headline ?? '',
    line: copy?.home_lede ?? '',
    slogan: copy?.home_slogan ?? '',
  };
  return b;
}
