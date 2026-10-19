import { createFileRoute } from '@tanstack/react-router';
import { SignInPage, safeNext } from '../../../features/identity/SignInPage.tsx';

export const Route = createFileRoute('/(staff)/access/sign-in')({
  validateSearch: (search: Record<string, unknown>): { next?: string } => {
    const next = safeNext(search.next);
    return next ? { next } : {};
  },
  component: function SignIn() {
    const { next } = Route.useSearch();
    return <SignInPage next={next} />;
  },
});
