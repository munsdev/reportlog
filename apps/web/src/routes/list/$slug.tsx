/**
 * A list's form, at the door path agreed with the identity workstream. With
 * the site password on, a list an administrator opened outside renders here
 * and nothing else does (features/identity/gate.tsx).
 */
import { createFileRoute } from '@tanstack/react-router';
import { ListFormPage } from '../../features/lists/ListForm.tsx';

export const Route = createFileRoute('/list/$slug')({
  component: ListRoute,
});

function ListRoute() {
  const { slug } = Route.useParams();
  return <ListFormPage slug={slug} />;
}
