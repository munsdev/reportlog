import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * The Links page became a filter on the reports queue, and each link is
 * judged where it appears, once for every copy (docs/design/moderation-unified.md).
 * Its blocklist is /moderate/blocklist. The old address keeps working.
 */
export const Route = createFileRoute('/(staff)/lists/links')({
  beforeLoad: () => {
    // The router's own redirect signal, which it expects to be thrown.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/moderate', search: { links: true }, replace: true });
  },
});
