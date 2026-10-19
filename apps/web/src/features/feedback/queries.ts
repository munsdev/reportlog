import {
  getFeedback,
  getFeedbackAdmin,
  getFeedbackQueue,
  listFeedback,
  listTesters,
} from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export const feedbackListQuery = queryOptions({
  queryKey: ['feedback', 'list'],
  queryFn: ({ signal }) => call(listFeedback, { signal }),
});

export const feedbackQuery = (id: number) =>
  queryOptions({
    queryKey: ['feedback', 'one', id],
    queryFn: ({ signal }) => call(getFeedback, { params: { id }, signal }),
  });

export const queueQuery = (status: string) =>
  queryOptions({
    queryKey: ['feedback', 'queue', status],
    queryFn: ({ signal }) => call(getFeedbackQueue, { query: { status }, signal }),
  });

export const adminIssueQuery = (id: number) =>
  queryOptions({
    queryKey: ['feedback', 'admin', id],
    queryFn: ({ signal }) => call(getFeedbackAdmin, { params: { id }, signal }),
  });

export const testersQuery = queryOptions({
  queryKey: ['feedback', 'testers'],
  queryFn: ({ signal }) => call(listTesters, { signal }),
});
