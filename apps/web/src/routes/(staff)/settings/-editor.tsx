/**
 * What every settings screen shares: the editor's state, one way to save,
 * and one way to say a save failed. Every save answers with the whole
 * editor state, so a screen shows what the server now holds rather than
 * what it hoped it sent.
 */
import { getSiteEditor } from '@reportlog/contracts';
import type { SiteEditor } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
