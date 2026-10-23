import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext, useLocation } from '@tanstack/react-router';
import { DevBadge } from '../components/ui/dev-badge.tsx';
import { SiteFooter } from '../components/ui/site-footer.tsx';
import { SiteLook } from '../components/ui/site.tsx';
import { StepUpHost } from '../features/identity/StepUp.tsx';
import { useGateMode } from '../features/identity/gateMode.ts';
import { useMe } from '../features/identity/session.ts';
import { PauseBanner } from '../features/flood/IntakePaused.tsx';
import { NotFoundPage } from '../features/site-pages/NotFound.tsx';
import { HeaderProgressProvider } from '../features/nav/progress.tsx';
import { SiteHeader } from '../features/nav/SiteHeader.tsx';
import { StaffShell } from '../features/nav/StaffShell.tsx';
import { inFrame } from '../features/staff-nav/entries.ts';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

function RootLayout() {
  return (
    <HeaderProgressProvider>
      <SiteLook />
      <Frame />
      <DevBadge />
      <StepUpHost />
    </HeaderProgressProvider>
  );
}

/**
 * Which frame this page is drawn in: the staff area's (features/nav/
 * StaffShell.tsx) on a page of the app for anybody signed in, else the
 * public one. Never the staff frame on a door, which may not ask who is
 * signed in; a door is never a staff page anyway.
 */
function Frame() {
  const door = useGateMode() === 'door';
  const { pathname } = useLocation();
  if (door || !inFrame(pathname)) return <PublicFrame />;
  return <StaffFrame />;
}

function StaffFrame() {
  const me = useMe();
  // While it is still being asked, the staff frame without its sidebar: on a
  // staff page that is by far the likelier answer, and the page does not
  // jump from one frame to the other for the people who use it every day.
  if (me.isPending)
    return (
      <StaffShell me={null}>
        <Outlet />
      </StaffShell>
    );
  const who = me.data?.signedIn ? me.data : null;
  // Signed out: the public frame, where the page's own guard explains.
  // Everybody signed in gets the app frame (decision 71).
  if (!who) return <PublicFrame />;
  return (
    <StaffShell me={who}>
      <Outlet />
    </StaffShell>
  );
}

function PublicFrame() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-card focus:bg-surface focus:p-2"
      >
        Skip to the content
      </a>
      {/* The header and its menu (features/nav): the only way around the
          public site, and the way into the staff area. */}
      <SiteHeader />
      <PauseBanner />
      <main
        id="main"
        className="mx-auto w-full max-w-page flex-1 pt-8 pr-[max(1rem,env(safe-area-inset-right))] pb-16 pl-[max(1rem,env(safe-area-inset-left))]"
      >
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
