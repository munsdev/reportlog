/**
 * One route, described once.
 *
 * The server registers a handler against this description and Fastify
 * validates the request and the response with it; the website calls through
 * the same description and gets the response type for free. A route whose
 * shape changes on one side and not the other fails to compile.
 *
 * Deliberately small: a method, a path, and zod schemas. Paths use Fastify's
 * `:param` syntax.
 */
import type { z } from 'zod';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteContract<
  P extends z.ZodType = z.ZodType,
  Q extends z.ZodType = z.ZodType,
  B extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> {
  method: Method;
  path: `/api/${string}`;
  summary: string;
  params?: P;
  query?: Q;
  body?: B;
  response: R;
}

export function defineRoute<
  P extends z.ZodType = z.ZodNever,
  Q extends z.ZodType = z.ZodNever,
  B extends z.ZodType = z.ZodNever,
  R extends z.ZodType = z.ZodType,
>(route: RouteContract<P, Q, B, R>): RouteContract<P, Q, B, R> {
  return route;
}

export type ResponseOf<C> =
  C extends RouteContract<z.ZodType, z.ZodType, z.ZodType, infer R> ? z.infer<R> : never;
export type ParamsOf<C> = C extends RouteContract<infer P> ? z.input<P> : never;
export type QueryOf<C> = C extends RouteContract<z.ZodType, infer Q> ? z.input<Q> : never;
export type BodyOf<C> = C extends RouteContract<z.ZodType, z.ZodType, infer B> ? z.input<B> : never;
