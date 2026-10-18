import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api.ts';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // A 4xx will not change by asking again.
        retry: (count, err) => !(err instanceof ApiRequestError && err.status < 500) && count < 2,
      },
    },
  });
}
