/**
 * The files screens. Deciding on files and asking for evidence is for
 * moderators; the site's switch, limits and erasing are for administrators.
 * Admin does not imply moderator, so each page names its own door rather
 * than this layout naming one.
 */
import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/(staff)/files')({
  component: Outlet,
});
