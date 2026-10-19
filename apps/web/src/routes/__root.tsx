import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { BrandName, SiteLook, useSite } from '../components/ui/site.tsx';
import { SessionNav } from '../features/identity/SessionNav.tsx';

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
      <header className="border-b-4 border-action bg-deep text-on-deep">
        <div className="mx-auto flex max-w-page items-center justify-between px-4 py-3">
          <Link to="/" className="font-display text-xl font-bold">
            {site ? <BrandName parts={site.name_parts} onDeep /> : 'ReportLog'}
          </Link>
          <SessionNav />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-page flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-line px-4 py-6 text-center text-sm text-muted">
        <p>Every report is fingerprinted and chained, so any later change shows.</p>
        <p className="mt-2 flex flex-wrap justify-center gap-x-4">
          <Link to="/legal" className="underline">
            Imprint, privacy and moderation
          </Link>
          {/* A deployment naming itself is not a deployment claiming to have written this. */}
          {site && site.plain_name !== site.software_name ? (
            <span>Runs on {site.software_name}</span>
          ) : null}
        </p>
      </footer>
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
