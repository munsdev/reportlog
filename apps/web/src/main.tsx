import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SiteGate } from './features/identity/gate.tsx';
import { installErrorReporting, rootErrorHandlers } from './features/telemetry/report.ts';
import { createQueryClient } from './lib/queryClient.ts';
import { routeTree } from './routeTree.gen.ts';
import './styles.css';
// The approved mock-up's stylesheet, after Tailwind so its rules win.
import './mockup/site.css';

const queryClient = createQueryClient();
const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Errors go to this site's server, and on to Bugsink only if it is set up.
// Nothing is asked or loaded until one happens.
// The mock-up's page script (public/mockup/site.js) fits headlines and draws the
// header background on what is on the page; redo it after each page is drawn.
declare global {
  interface Window {
    elRefresh?: () => void;
    elLookSwitcher?: (on: boolean) => void;
  }
}
router.subscribe('onResolved', () => {
  requestAnimationFrame(() => window.elRefresh?.());
});

installErrorReporting(() => router.state.matches.at(-1)?.routeId);

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');

createRoot(root, rootErrorHandlers).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* While the site password is needed the router is not mounted, so
          nothing behind it renders and nothing can make it navigate. */}
      <SiteGate history={router.history} pathname={window.location.pathname}>
        <RouterProvider router={router} />
      </SiteGate>
    </QueryClientProvider>
  </StrictMode>,
);
