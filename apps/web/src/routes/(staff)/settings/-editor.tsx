/**
 * What every settings screen shares: the editor's state, one way to save,
 * one way to say a save failed, and one warning before unsaved work is
 * lost. Every save answers with the whole editor state, so a screen shows
 * what the server now holds rather than what it hoped it sent.
 */
import { getSiteEditor } from '@reportlog/contracts';
import type { SiteEditor } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';

export const editorQuery = queryOptions({
  queryKey: ['site-editor'],
  queryFn: ({ signal }) => call(getSiteEditor, { signal }),
});

/** Save something, then refresh everything a public page reads from it. */
export function useSave<V>(save: (value: V) => Promise<SiteEditor>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: save,
    onSuccess: (state) => {
      client.setQueryData(editorQuery.queryKey, state);
      for (const key of [['site'], ['legal'], ['home-buttons']]) {
        void client.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** Why the editor could not be opened, in words. */
function whyNot(error: Error): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) {
      return 'Only an administrator can change these settings. Sign in as one to go on.';
    }
    if (error.status === 404) {
      return 'This server does not offer the settings yet: they open once signing in is built.';
    }
  }
  return error.message;
}

/** Renders its children with the editor's state, or says why it cannot. */
export function WithEditor({ children }: { children: (state: SiteEditor) => ReactNode }) {
  const query = useQuery(editorQuery);
  if (query.isPending) return <p role="status">Loading the settings…</p>;
  if (query.isError) {
    return (
      <Alert tone="serious" title="The settings could not be opened.">
        {whyNot(query.error)}
      </Alert>
    );
  }
  return <>{children(query.data)}</>;
}

/** What a save said: nothing yet, done, or why not. */
export function SaveOutcome({
  mutation,
  done,
}: {
  mutation: { isSuccess: boolean; isError: boolean; error: Error | null };
  done: string;
}) {
  if (mutation.isError && mutation.error) {
    return (
      <Alert tone="serious" title="That was not saved.">
        {mutation.error.message}
      </Alert>
    );
  }
  if (mutation.isSuccess) return <Alert tone="confirmed" title={done} />;
  return null;
}

// ── unsaved changes ──────────────────────────────────────────────────────
//
// ONE QUESTION FOR THE WHOLE SETTINGS AREA, not one per panel. Page wording
// has nine boxes; nine blockers would ask nine times. Each editor says
// whether it differs from what the server holds, and the layout asks once,
// naming every one that does, before the router leaves the settings area or
// moves to another settings screen, and before the tab is closed or
// reloaded (the browser asks that one in its own words).
//
// "Differs from what the server holds", not "was typed in": typing a
// sentence and deleting it again leaves nothing to lose, and a save makes
// the panel clean the moment the server's answer arrives.

type Unsaved = Map<string, string>;

const UnsavedContext = createContext<{ set: (id: string, name: string | null) => void } | null>(
  null,
);

/** The sentence the warning asks, naming what would be lost. */
export function unsavedQuestion(names: readonly string[]): string {
  const list =
    names.length <= 1
      ? (names[0] ?? 'this screen')
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return `You have changes to ${list} that are not saved. Leave without saving them?`;
}

/** Wraps the settings screens. Holds the one blocker. */
export function UnsavedChangesGuard({
  children,
  ask = (q: string) => window.confirm(q),
}: {
  children: ReactNode;
  ask?: (question: string) => boolean;
}) {
  const unsaved = useRef<Unsaved>(new Map());
  const set = useCallback((id: string, name: string | null) => {
    if (name === null) unsaved.current.delete(id);
    else unsaved.current.set(id, name);
  }, []);
  useBlocker({
    shouldBlockFn: () => {
      const names = [...new Set(unsaved.current.values())];
      if (!names.length) return false;
      return !ask(unsavedQuestion(names));
    },
    enableBeforeUnload: () => unsaved.current.size > 0,
  });
  const value = useMemo(() => ({ set }), [set]);
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

/**
 * Say whether this editor holds something the server does not. `name` is
 * what the question calls it ("the Imprint"). Outside the guard (a test
 * rendering one form) it does nothing.
 */
export function useUnsavedChanges(name: string, dirty: boolean): void {
  const guard = useContext(UnsavedContext);
  const id = useId();
  useEffect(() => {
    guard?.set(id, dirty ? name : null);
  }, [guard, id, name, dirty]);
  useEffect(
    () => () => {
      guard?.set(id, null);
    },
    [guard, id],
  );
}
