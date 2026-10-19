/**
 * Rows as the API sends them: every Date as its ISO string, recursively, so
 * a response schema that says `string` is satisfied by what the database
 * gave back without each route converting field by field.
 */
export type Jsonified<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;

export function json<T>(value: T): Jsonified<T> {
  if (value instanceof Date) return value.toISOString() as Jsonified<T>;
  if (Array.isArray(value)) return value.map((v: unknown) => json(v)) as Jsonified<T>;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, json(v)]),
    ) as Jsonified<T>;
  }
  return value as Jsonified<T>;
}
