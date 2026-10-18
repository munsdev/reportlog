import { z } from 'zod';
import { defineRoute } from './route.ts';

export const CardVariant = z.enum(['general', 'coordinator']);

export const PublicationCard = z.object({
  variant: CardVariant,
  question: z.string(),
  body: z.array(z.string()),
  optionality: z.string(),
  options: z.object({ yes: z.string(), no: z.string() }),
  /** What the form sends back with the answer. Issued by the server, never computed by a client. */
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PublicationCard = z.infer<typeof PublicationCard>;

export const getPublicationCard = defineRoute({
  method: 'GET',
  path: '/api/publication-card',
  summary: 'The wording of the "may this be published?" card, and its digest.',
  query: z.object({ variant: CardVariant.default('general') }),
  response: PublicationCard,
});
