import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * The Written accounts page became a filter on the reports queue
 * (docs/design/moderation-unified.md). The old address keeps working.
 */
export const Route = createFileRoute('/(staff)/moderate/texts/')({
  beforeLoad: () => {
    // The router's own redirect signal, which it expects to be thrown.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/moderate', search: { written: true }, replace: true });
  },
});
