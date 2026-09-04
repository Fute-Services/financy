import { describe, expect, it } from 'vitest';

import { SlidingWindowCounter } from './sliding-window.js';

const RULE = { limit: 3, windowSeconds: 60 } as const;
const T0 = 1_700_000_000_000;

describe('SlidingWindowCounter', () => {
  it('allows up to the limit and counts down what is left', () => {
    const counter = new SlidingWindowCounter();

    expect(counter.hit('a', RULE, T0)).toMatchObject({ allowed: true, remaining: 2 });
    expect(counter.hit('a', RULE, T0 + 1)).toMatchObject({ allowed: true, remaining: 1 });
    expect(counter.hit('a', RULE, T0 + 2)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('refuses the request past the limit', () => {
    const counter = new SlidingWindowCounter();

    for (let i = 0; i < RULE.limit; i++) counter.hit('a', RULE, T0 + i);

    const verdict = counter.hit('a', RULE, T0 + 10);

    expect(verdict.allowed).toBe(false);
    expect(verdict.remaining).toBe(0);
  });

  it('keys callers separately', () => {
    const counter = new SlidingWindowCounter();

    for (let i = 0; i < RULE.limit; i++) counter.hit('a', RULE, T0 + i);

    expect(counter.hit('a', RULE, T0 + 10).allowed).toBe(false);
    expect(counter.hit('b', RULE, T0 + 10).allowed).toBe(true);
  });

  it('lets the window slide rather than resetting on a boundary', () => {
    const counter = new SlidingWindowCounter();
    const windowMs = RULE.windowSeconds * 1000;

    // One hit early in the window and two late in it. Which one ages out first
    // is the whole difference between a sliding window and a fixed bucket.
    counter.hit('a', RULE, T0);
    counter.hit('a', RULE, T0 + 30_000);
    counter.hit('a', RULE, T0 + 31_000);

    expect(counter.hit('a', RULE, T0 + windowMs - 1).allowed).toBe(false);

    // One millisecond past the first hit's expiry, exactly **one** slot opens.
    // A fixed bucket would have reset the whole allowance at this boundary,
    // permitting six requests inside 62 seconds under a limit of three.
    expect(counter.hit('a', RULE, T0 + windowMs + 1).allowed).toBe(true);
    expect(counter.hit('a', RULE, T0 + windowMs + 2).allowed).toBe(false);

    // The other two only free up when *they* age out, 30 seconds later.
    expect(counter.hit('a', RULE, T0 + 30_000 + windowMs + 1).allowed).toBe(true);
  });

  it('does not count a refused request against the caller', () => {
    const counter = new SlidingWindowCounter();
    const windowMs = RULE.windowSeconds * 1000;

    for (let i = 0; i < RULE.limit; i++) counter.hit('a', RULE, T0 + i);

    // Hammering while over the limit must not push the window forward. If it
    // did, the caller could hold themselves locked out indefinitely and the
    // retry at the stated time would fail too.
    for (let i = 0; i < 50; i++) counter.hit('a', RULE, T0 + 100 + i);

    expect(counter.hit('a', RULE, T0 + windowMs + 1).allowed).toBe(true);
  });

  it('reports a retry-after that is in the future and never zero', () => {
    const counter = new SlidingWindowCounter();

    for (let i = 0; i < RULE.limit; i++) counter.hit('a', RULE, T0 + i);

    // One millisecond before the window frees a slot: rounding down would say
    // "retry in 0 seconds", which is an invitation to a busy loop.
    const verdict = counter.hit('a', RULE, T0 + RULE.windowSeconds * 1000 - 1);

    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('reports a reset instant that matches when a slot actually frees', () => {
    const counter = new SlidingWindowCounter();
    const windowMs = RULE.windowSeconds * 1000;

    for (let i = 0; i < RULE.limit; i++) counter.hit('a', RULE, T0 + i);

    const verdict = counter.hit('a', RULE, T0 + 10);

    // The oldest hit was at T0, so the slot frees exactly one window later.
    expect(verdict.resetAt).toBe(T0 + windowMs);
  });

  it('forgets keys that have gone quiet', () => {
    const counter = new SlidingWindowCounter();
    const day = 24 * 60 * 60 * 1000;

    counter.hit('a', RULE, T0);

    // A sweep runs at most once a minute, so it takes a later hit from anybody
    // to trigger one. After a day of silence the key is dropped — without
    // that, the map grows forever on a value the caller controls.
    counter.hit('b', RULE, T0 + day + 1);

    expect(counter.hit('a', RULE, T0 + day + 2)).toMatchObject({
      allowed: true,
      remaining: RULE.limit - 1,
    });
  });
});
