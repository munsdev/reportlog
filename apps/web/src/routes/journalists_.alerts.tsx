import { createFileRoute } from '@tanstack/react-router';
import { SignupPage } from '../features/journalists/SignupPage.tsx';

export const Route = createFileRoute('/journalists_/alerts')({
  // `access=1` arrives from the landing page's "Apply for desk access" card.
  validateSearch: (search: Record<string, unknown>): { access?: '1' } =>
    search.access === '1' || search.access === 1 ? { access: '1' } : {},
  component: function Signup() {
    const { access } = Route.useSearch();
    return <SignupPage askForAccess={access === '1'} />;
  },
});
