import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Files waiting became a filter on the reports queue; a report's files are
 * decided on its page (docs/design/moderation-unified.md). The old address
 * keeps working.
 */
export const Route = createFileRoute('/(staff)/files/')({
  beforeLoad: () => {
    // The router's own redirect signal, which it expects to be thrown.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/moderate', search: { files: true }, replace: true });
  },
});
