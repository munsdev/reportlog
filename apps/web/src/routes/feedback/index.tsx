import { createFileRoute } from '@tanstack/react-router';
import { FeedbackPage } from '../../features/feedback/FeedbackPage.tsx';
import { OnlyFor } from '../../features/staff-nav/OnlyFor.tsx';

export const Route = createFileRoute('/feedback/')({
  // Which screen the tester came from, as the router names it (the menu adds
  // it). A route id, never an address: an address can carry a token.
  validateSearch: (search: Record<string, unknown>): { from?: string } =>
    typeof search.from === 'string' && /^[\w/().$-]{1,200}$/.test(search.from)
      ? { from: search.from }
      : {},
  component: function Feedback() {
    const { from } = Route.useSearch();
    return (
      <OnlyFor
        audience={['tester', 'admin', 'access_manager']}
        who="testers, administrators and Access Managers"
      >
        <FeedbackPage from={from} />
      </OnlyFor>
    );
  },
});
