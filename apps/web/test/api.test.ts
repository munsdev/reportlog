import { health, verifyReport } from '@reportlog/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError, call, pathFor } from '../src/lib/api.ts';

const respond =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('pathFor', () => {
  it('fills and encodes parameters', () => {
    expect(pathFor('/api/reports/:ref/verify', { ref: 'RL 1/2' })).toBe(
      '/api/reports/RL%201%2F2/verify',
    );
    expect(() => pathFor('/api/reports/:ref/verify', {})).toThrow(/:ref/);
  });
});

describe('call', () => {
  it('returns the validated response', async () => {
    await expect(call(health, {}, respond(200, { ok: true, database: 'up' }))).resolves.toEqual({
      ok: true,
      database: 'up',
    });
  });

  it('turns the API error shape into an error with its sentence', async () => {
    const err = await call(
      verifyReport,
      { params: { ref: 'X' } },
      respond(404, { error: { code: 'not_found', message: 'There is no report X.' } }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 404, code: 'not_found', message: 'There is no report X.' });
  });

  it('refuses a response that does not match the contract', async () => {
    await expect(call(health, {}, respond(200, { ok: 'yes' }))).rejects.toMatchObject({
      code: 'bad_response',
    });
  });
});
