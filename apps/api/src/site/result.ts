/** What a validator answers: the value to store, or a sentence saying why not. */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
