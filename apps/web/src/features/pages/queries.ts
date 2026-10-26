import { getPageEditor, getPageBlocks } from '@reportlog/contracts';
import type { PageId } from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '@/lib/api.ts';

export const pageBlocksQuery = (page: PageId) =>
  queryOptions({
    queryKey: ['page-blocks', page],
    queryFn: ({ signal }) => call(getPageBlocks, { params: { page }, signal }),
  });

export const pageEditorQuery = (page: PageId) =>
  queryOptions({
    queryKey: ['page-editor', page],
    queryFn: ({ signal }) => call(getPageEditor, { params: { page }, signal }),
    refetchOnMount: 'always',
  });
