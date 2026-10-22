import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { DevBadge } from '../components/ui/dev-badge.tsx';
import { SiteFooter } from '../components/ui/site-footer.tsx';
import { SiteLook } from '../components/ui/site.tsx';
import { StepUpHost } from '../features/identity/StepUp.tsx';
import { PauseBanner } from '../features/flood/IntakePaused.tsx';
import { NotFoundPage } from '../features/site-pages/NotFound.tsx';
import { AreaTabsFallback, AreaTabsSlot } from '../features/nav/AreaTabs.tsx';
import { HeaderProgressProvider } from '../features/nav/progress.tsx';
import { SiteHeader } from '../features/nav/SiteHeader.tsx';

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
      <AreaTabsSlot>
        <div className="flex min-h-dvh flex-col">
          <SiteLook />
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-card focus:bg-surface focus:p-2"
          >
            Skip to the content
          </a>
          {/* The header and its menu (features/nav): the only way around the
              site. It replaces the session links and the staff bar. */}
          <SiteHeader />
          <PauseBanner />
          <main
            id="main"
            className="mx-auto w-full max-w-page flex-1 pt-8 pr-[max(1rem,env(safe-area-inset-right))] pb-16 pl-[max(1rem,env(safe-area-inset-left))]"
          >
            {/* A staff page's area tabs, until the page draws its own
                under its heading (features/nav/AreaTabs.tsx). */}
            <AreaTabsFallback className="mb-6" />
            <Outlet />
          </main>
          <SiteFooter />
          <DevBadge />
          <StepUpHost />
        </div>
      </AreaTabsSlot>
    </HeaderProgressProvider>
  );
}
