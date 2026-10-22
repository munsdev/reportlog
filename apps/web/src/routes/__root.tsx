import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { DevBadge } from '../components/ui/dev-badge.tsx';
import { SiteFooter } from '../components/ui/site-footer.tsx';
import { BrandName, SiteLook, useSite } from '../components/ui/site.tsx';
import { SessionNav } from '../features/identity/SessionNav.tsx';
import { StepUpHost } from '../features/identity/StepUp.tsx';
import { StaffNav } from '../features/staff-nav/StaffNav.tsx';
import { PauseBanner } from '../features/flood/IntakePaused.tsx';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  const site = useSite().data;
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteLook />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-card focus:bg-surface focus:p-2"
      >
        Skip to the content
      </a>
      <header className="border-b-4 border-action bg-deep text-on-deep print:hidden">
        {/* ONE ROW AT EVERY WIDTH: the name gives way (it is cut short, and
            the page's heading says it in full) and the links scroll sideways,
            rather than either wrapping onto a second line. */}
        <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-4 py-1">
          <Link
            to="/"
            className="block min-w-0 max-w-[55%] shrink-0 truncate font-display text-xl font-bold leading-[2.75rem]"
          >
            {site ? <BrandName parts={site.name_parts} onDeep /> : 'ReportLog'}
          </Link>
          <SessionNav />
        </div>
      </header>
      <StaffNav />
      <PauseBanner />
      <main
        id="main"
        className="mx-auto w-full max-w-page flex-1 pt-8 pr-[max(1rem,env(safe-area-inset-right))] pb-16 pl-[max(1rem,env(safe-area-inset-left))]"
      >
        <Outlet />
      </main>
      <SiteFooter />
      <DevBadge />
      <StepUpHost />
    </div>
  );
}

function NotFound() {
  return (
    <section className="space-y-3">
      <h1 className="font-display text-2xl font-bold">Nothing here</h1>
      <p>
        There is no page at this address.{' '}
        <Link to="/" className="underline">
          Go to the front page
        </Link>
        .
      </p>
    </section>
  );
}
