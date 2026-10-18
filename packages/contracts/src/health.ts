import { z } from 'zod';
import { defineRoute } from './route.ts';

export const health = defineRoute({
  method: 'GET',
  path: '/api/health',
  summary: 'Whether the server and its database are answering.',
  response: z.object({
    ok: z.boolean(),
    database: z.enum(['up', 'down']),
  }),
});
