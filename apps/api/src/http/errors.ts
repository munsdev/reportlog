/**
 * Every error leaves in one shape (`ApiError` in @reportlog/contracts), with
 * a sentence a person can read. Internal details are logged, never sent.
 */
import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (message: string) => new HttpError(404, 'not_found', message);

export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: 'invalid_request',
          message: err.validation
            .map((v) => `${v.instancePath || 'request'}: ${v.message ?? 'invalid'}`)
            .join('; '),
        },
      });
    }
    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'internal', message: 'Something went wrong on our side. It has been logged.' },
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'not_found', message: `Nothing at ${request.method} ${request.url}.` },
    }),
  );
}
