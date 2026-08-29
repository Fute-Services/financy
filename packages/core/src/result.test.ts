import { describe, it, expect } from 'vitest';
import {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
  all,
  tryCatch,
  tryCatchAsync,
} from './result.js';

describe('Result', () => {
  it('constructs and discriminates', () => {
    const success = ok(42);
    const failure = err(new Error('nope'));

    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    expect(isOk(failure)).toBe(false);
    expect(isErr(failure)).toBe(true);

    if (isOk(success)) expect(success.value).toBe(42);
    if (isErr(failure)) expect(failure.error.message).toBe('nope');
  });

  it('unwraps, throwing the contained error on failure', () => {
    expect(unwrap(ok('value'))).toBe('value');
    expect(() => unwrap(err(new Error('boom')))).toThrow('boom');
    // A non-Error failure is still thrown as an Error, so stack traces work.
    expect(() => unwrap(err('a string failure'))).toThrow('a string failure');
  });

  it('falls back without throwing', () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(err(new Error()), 0)).toBe(0);
  });

  it('maps the success channel and leaves the failure channel alone', () => {
    expect(unwrap(map(ok(2), (n) => n * 3))).toBe(6);
    const mapped = map(err(new Error('e')), (n: number) => n * 3);
    expect(isErr(mapped)).toBe(true);
  });

  it('maps the failure channel', () => {
    const remapped = mapErr(err('raw'), (e) => new Error(`wrapped: ${e}`));
    if (isErr(remapped)) expect(remapped.error.message).toBe('wrapped: raw');
  });

  it('chains, short-circuiting on the first failure', () => {
    const chained = andThen(ok(4), (n) => (n > 0 ? ok(n * 2) : err('negative')));
    expect(unwrap(chained)).toBe(8);

    const shortCircuited = andThen(err<string>('stop'), (n: number) => ok(n));
    expect(isErr(shortCircuited)).toBe(true);
  });

  it('collects a list, failing on the first error', () => {
    expect(unwrap(all([ok(1), ok(2), ok(3)]))).toEqual([1, 2, 3]);

    const collected = all([ok(1), err('bad'), ok(3)]);
    expect(isErr(collected)).toBe(true);
    if (isErr(collected)) expect(collected.error).toBe('bad');

    expect(unwrap(all([]))).toEqual([]);
  });

  it('captures a throwing function', () => {
    expect(unwrap(tryCatch(() => 'fine'))).toBe('fine');

    const caught = tryCatch(() => {
      throw new Error('thrown');
    });
    expect(isErr(caught)).toBe(true);
  });

  it('captures a rejecting promise', async () => {
    expect(unwrap(await tryCatchAsync(() => Promise.resolve('fine')))).toBe('fine');

    // Rejection after a real suspension point, which is how a provider call
    // or a database error actually fails — not a synchronous throw dressed up
    // as async.
    const caught = await tryCatchAsync(async () => {
      await Promise.resolve();
      throw new Error('rejected');
    });
    expect(isErr(caught)).toBe(true);

    // A synchronous throw inside an async function is also captured.
    const syncThrow = await tryCatchAsync(() => Promise.reject(new Error('rejected early')));
    expect(isErr(syncThrow)).toBe(true);
  });
});
