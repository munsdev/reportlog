import { createFileRoute } from '@tanstack/react-router';
import { AccountPage } from '../../features/account/AccountPage.tsx';

export const Route = createFileRoute('/(staff)/account')({
  component: AccountPage,
});
