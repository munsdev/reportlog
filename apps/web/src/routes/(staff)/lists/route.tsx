/**
 * The lists screens. Making and changing lists is for administrators (which
 * includes the owner); reviewing entries is for moderators and administrators,
 * so each page names its own door rather than this layout naming one.
 */
import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/(staff)/lists')({
  component: Outlet,
});
