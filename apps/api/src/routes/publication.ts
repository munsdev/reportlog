import { getPublicationCard } from '@reportlog/contracts';
import { cardFor } from '@reportlog/seal';
import type { FastifyInstance } from 'fastify';
import { route } from '../http/route.ts';

export function publicationRoutes(app: FastifyInstance): void {
  route(app, getPublicationCard, ({ query }) => cardFor(query.variant ?? 'general'));
}
