import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Outlet, createRootRouteWithContext, useLocation } from '@tanstack/react-router';
import { DevBadge } from '../components/ui/dev-badge.tsx';
import { FollowButton } from '../components/ui/follow-button.tsx';
import { SiteFooter } from '../components/ui/site-footer.tsx';
import { SiteLook } from '../components/ui/site.tsx';
import { StepUpHost } from '../features/identity/StepUp.tsx';
import { useGateMode } from '../features/identity/gateMode.ts';
import { useMe } from '../features/identity/session.ts';
import { PauseBanner } from '../features/flood/IntakePaused.tsx';
import { NotFoundPage } from '../features/site-pages/NotFound.tsx';
import { HeaderProgressProvider } from '../features/nav/progress.tsx';
import { SiteHeader } from '../features/nav/SiteHeader.tsx';
import { Ticker } from '../features/nav/Ticker.tsx';
import { StaffShell } from '../features/nav/StaffShell.tsx';
import { inFrame } from '../features/staff-nav/entries.ts';
import { EasyClass } from '../mockup/EasierReading.tsx';
import { SiteLookScript } from '../mockup/siteLook.tsx';

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
      <SiteLookScript />
      <Frame />
      <DevBadge />
      <FollowButton />
      <StepUpHost />
      <LookSwitcher />
      <EasyClass />
      {/* Where the mock-up's page script says things ("Copied", "Saved"). */}
      <div className="toast" id="toast" role="status" aria-live="polite" />
    </HeaderProgressProvider>
  );
}

/**
 * The mock-up's floating look switcher (public/mockup/site.js), for an
 * administrator or the owner only. Not on a door, which may not ask who is
 * signed in.
 */
function LookSwitcher() {
  return useGateMode() === 'door' ? null : <LookSwitcherFor />;
}

function LookSwitcherFor() {
  const me = useMe();
  const admin =
    me.data?.signedIn === true && me.data.roles.some((r) => r === 'admin' || r === 'owner');
  useEffect(() => {
    window.elLookSwitcher?.(admin);
  }, [admin]);
  return null;
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
      <a className="skip" href="#main">
        Skip to content
      </a>
      {/* The header and its menu (features/nav): the only way around the
          public site, and the way into the staff area. */}
      <SiteHeader />
      <Ticker />
      <PauseBanner />
      <main id="main" tabIndex={-1} className="w-full flex-1">
        {/* The padded column. A page that draws its own bands marks its root
            `data-bleed` and this steps aside (styles.css, .rl-pad). The front
            page does, and draws its Follow along band itself, under its
            headline (D11). */}
        <div className="rl-pad mx-auto w-full max-w-page pt-8 pr-[max(1rem,env(safe-area-inset-right))] pb-16 pl-[max(1rem,env(safe-area-inset-left))]">
          <Outlet />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
