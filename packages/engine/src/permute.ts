/**
 * Presentation-only pick-display permutation (spec §4.6).
 *
 * A pure function of the answers: xorshift32 PRNG seeded from FNV-1a of a
 * per-screen seed string, driving a descending Fisher–Yates shuffle. It never
 * changes which options appear, only their on-screen order, and NEVER feeds
 * resolution (tag/variant read option IDs, never positions).
 */

import { fnv1a32String, FNV_OFFSET_BASIS } from "./hash.js";

/**
 * One xorshift32 step (spec §4.6, pinned order). `x` is treated as an unsigned
 * 32-bit integer; the returned value is the next state, also unsigned 32-bit.
 */
export function xorshift32(x: number): number {
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x >>> 0;
}

/**
 * Seed the PRNG from a seed string (spec §4.6). `seed = FNV-1a(seedString)`;
 * if that is 0 (unreachable on a non-empty string) it becomes the offset basis.
 */
export function seedFromString(seedString: string): number {
  const s = fnv1a32String(seedString) >>> 0;
  return s === 0 ? FNV_OFFSET_BASIS : s;
}

/**
 * Fisher–Yates (descending, 0-based) driven by xorshift32, exactly one PRNG
 * step per iteration (spec §4.6). Returns a NEW array; input is not mutated.
 * `n <= 1` is a no-op.
 */
export function permute<T>(items: readonly T[], seedString: string): T[] {
  const a = items.slice();
  const n = a.length;
  if (n <= 1) return a;
  let x = seedFromString(seedString);
  for (let i = n - 1; i >= 1; i--) {
    x = xorshift32(x);
    const j = x % (i + 1);
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}
