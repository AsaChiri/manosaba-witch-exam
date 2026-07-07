/**
 * Deterministic hashing + canonical serialization (spec §4.4).
 *
 * FNV-1a 32-bit over UTF-8 bytes. Order-sensitive, locale-independent,
 * version-pinned. No salt / RNG / time / user-ID anywhere.
 */

export const FNV_OFFSET_BASIS = 0x811c9dc5; // 2166136261
export const FNV_PRIME = 0x01000193; // 16777619

/** FNV-1a 32-bit over a byte array. Returns an unsigned 32-bit integer. */
export function fnv1a32(bytes: Uint8Array): number {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    // 32-bit multiply without precision loss (Math.imul), then coerce unsigned.
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

const UTF8 = new TextEncoder();

/** FNV-1a 32-bit over the UTF-8 encoding of a string. */
export function fnv1a32String(s: string): number {
  return fnv1a32(UTF8.encode(s));
}

/**
 * Canonical answer string (spec §4.4): every slot in `slots` order, one token
 * `QID:OID` (or `QID:<sentinel>` when not administered), joined with `|`.
 *
 * `tokenMap` supplies the OID for administered slots. O.C1 tokenizes as its
 * chosen family; picks as their chosen sub-variant / group id; the sentinel is
 * used for every slot absent from the map.
 */
export function canonicalString(
  tokenMap: Readonly<Record<string, string>>,
  slots: readonly string[],
  sentinel: string,
): string {
  const parts = new Array<string>(slots.length);
  for (let i = 0; i < slots.length; i++) {
    const qid = slots[i]!;
    const oid = tokenMap[qid];
    parts[i] = `${qid}:${oid === undefined ? sentinel : oid}`;
  }
  return parts.join("|");
}
