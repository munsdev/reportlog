import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-card focus:bg-surface focus:p-2"
      >
        Skip to the content
      </a>
      <header className="border-b-4 border-action bg-deep text-on-deep">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-display text-xl font-bold">
            ReportLog
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-line px-4 py-6 text-center text-sm text-muted">
        Every report is fingerprinted and chained, so any later change shows.
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
