import { z } from 'zod';

/**
 * Every error the API returns has this shape. `message` is a sentence a
 * person can read; `code` is what code branches on.
 */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
