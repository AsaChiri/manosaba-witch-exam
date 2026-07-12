/**
 * Tag resolution — nearest-authored-pair fallback (spec §4.3) + variant
 * selection (spec §4.4). The tier algorithm is the single source of truth: the
 * compiler runs it to precompute `neighbor.json`; the engine ships that table
 * for O(1) runtime lookup and keeps the algorithm as the authoritative fallback.
 */

export interface AuthoredTag {
  tag: string;
  /** origin sub-variant id (e.g. "ED-1"). */
  origin: string;
  /** coping sub-variant id (e.g. "P-2"). */
  coping: string;
  /** manifest listing order (earliest-authored wins ties). */
  manifestIndex: number;
}

export interface TagResult {
  tag: string;
  tier: 0 | 1 | 2 | 3;
}

/** file-index adjacency: numeric suffix of a sub-variant id (listing order). */
export function subvariantIndex(id: string): number {
  const m = /(\d+)\s*$/.exec(id);
  return m ? parseInt(m[1]!, 10) : 0;
}

/**
 * Resolve picked pair (o, c) to a served tag over a cell's authored set,
 * ranking by ascending (tier, distance, manifestIndex) per spec §4.3:
 *  tier 0 exact · tier 1 origin-match (dist = coping adjacency) ·
 *  tier 2 coping-match (dist = origin adjacency) ·
 *  tier 3 neither (dist = origin adjacency, then coping adjacency).
 * Tier 1 is never empty when some authored tag carries `o` (eligibility
 * guarantee), so the served card preserves the picked origin sub-variant.
 */
export function resolveTag(
  o: string,
  c: string,
  authored: readonly AuthoredTag[],
  originIndex: (sub: string) => number = subvariantIndex,
  copingIndex: (sub: string) => number = subvariantIndex,
): TagResult | null {
  if (authored.length === 0) return null;
  let best: { key: number[]; tag: string; tier: 0 | 1 | 2 | 3 } | null = null;
  for (const t of authored) {
    const oMatch = t.origin === o;
    const cMatch = t.coping === c;
    let tier: 0 | 1 | 2 | 3;
    let d1: number;
    let d2: number;
    if (oMatch && cMatch) {
      tier = 0;
      d1 = 0;
      d2 = 0;
    } else if (oMatch) {
      tier = 1;
      d1 = Math.abs(copingIndex(t.coping) - copingIndex(c));
      d2 = 0;
    } else if (cMatch) {
      tier = 2;
      d1 = Math.abs(originIndex(t.origin) - originIndex(o));
      d2 = 0;
    } else {
      tier = 3;
      d1 = Math.abs(originIndex(t.origin) - originIndex(o));
      d2 = Math.abs(copingIndex(t.coping) - copingIndex(c));
    }
    const key = [tier, d1, d2, t.manifestIndex];
    if (best === null || cmp(key, best.key) < 0) {
      best = { key, tag: t.tag, tier };
    }
  }
  return best ? { tag: best.tag, tier: best.tier } : null;
}

/** variantIndex = hash mod N (spec §4.4). N<=1 => 0 (no hash needed). */
export function selectVariant(hash: number, n: number): number {
  if (n <= 1) return 0;
  return (hash >>> 0) % n;
}

function cmp(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}
