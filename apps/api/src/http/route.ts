/**
 * Register a handler against a contract from @reportlog/contracts.
 *
 * Fastify validates the request with the contract's schemas and serializes
 * the response through its response schema, so a handler cannot return a
 * field the contract does not declare: it is stripped, not leaked.
 */
import type { ParamsOf, QueryOf, ResponseOf, RouteContract } from '@reportlog/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { z } from 'zod';

export interface HandlerInput<C> {
  params: ParamsOf<C>;
  query: QueryOf<C>;
  request: FastifyRequest;
  reply: FastifyReply;
}

export function route<
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType,
>(
  app: FastifyInstance,
  contract: RouteContract<P, Q, B, R>,
  handler: (
    input: HandlerInput<RouteContract<P, Q, B, R>>,
  ) => ResponseOf<RouteContract<P, Q, B, R>> | Promise<ResponseOf<RouteContract<P, Q, B, R>>>,
  // Route-level settings Fastify reads at registration: today only the list
  // routes' `curtain` mark, which the gate checks as each route registers.
  extra: Pick<RouteOptions, 'config'> = {},
): void {
  // Typed by this wrapper rather than by Fastify's type provider: the
  // contract already says what goes in and out, and saying it twice is how
  // the two would come to disagree.
  const options: RouteOptions = {
    ...extra,
    method: contract.method,
    url: contract.path,
    schema: {
      summary: contract.summary,
      ...(contract.params ? { params: contract.params } : {}),
      ...(contract.query ? { querystring: contract.query } : {}),
      ...(contract.body ? { body: contract.body } : {}),
      response: { 200: contract.response },
    },
    handler: (request, reply) =>
      handler({
        params: request.params as ParamsOf<RouteContract<P, Q, B, R>>,
        query: request.query as QueryOf<RouteContract<P, Q, B, R>>,
        request,
        reply,
      }),
  };
  app.route(options);
}
