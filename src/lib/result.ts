/**
 * A tiny Result type used across the domain to make failure explicit instead
 * of throwing for expected, recoverable outcomes (duplicate lead, blocked
 * claim, closed API window, ...). Exceptions remain reserved for programmer
 * errors and truly exceptional infrastructure failures.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/** Unwrap a Result, throwing when it is an error. Use only at trust boundaries. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap on Err: ${JSON.stringify(r.error)}`);
}
