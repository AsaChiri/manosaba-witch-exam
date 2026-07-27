/**
 * Total cell-coverage map (design spec §5 — "EVERY cell must resolve
 * deterministically to the nearest SHIPPED tag").
 *
 * This module recomputes, from the current ship list on every compile, a TOTAL
 * map: every one of the 8x25 grid cells that is not itself shipped-covered is
 * routed to a shipped cell, so the coverage invariant always holds and
 * self-heals as the ship list grows.
 *
 * Ranking tiers (nearest shipped cell), best first:
 *   1  same origin family + same coping stance
 *   2  same origin family (any stance)
 *   3  same coping stance (nearest family)
 *   4  global default — the shipped cell with the highest density
 *
 * Within a tier: order by coping file-index adjacency distance, tie-broken by
 * fixed manifest order. Authorial §3 routes are preserved verbatim when their
 * target is shipped; otherwise the source is re-routed per the tiers.
 */
import { cellKey } from "@manosaba/witch-exam-engine";

export interface ShippedCellInfo {
  cell: string;
  family: string;
  style: string;
  tagCount: number;
  manifestOrder: number;
}

export interface CoverageEntry {
  from: string;
  to: string;
  kind: "manifest" | "fallback";
  tier: number;
}

export interface CoverageResult {
  redirect: Record<string, string>;
  entries: CoverageEntry[];
  direct: string[];
  counts: {
    direct: number;
    manifest: number;
    fallback: number;
    tier: Record<number, number>;
  };
}

function cmp(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

export function buildCoverageMap(args: {
  families: string[];
  styles: string[];
  styleStance: Record<string, string>;
  shipped: ShippedCellInfo[];
  manifestRedirect: Record<string, string>;
  /**
   * Character-only cells self-provide coverage, but are excluded from fallback
   * targets because they have no ordinary card to show a redirected arrival.
   */
  directOnly?: string[];
}): CoverageResult {
  const { families, styles, styleStance, shipped, manifestRedirect } = args;
  const directOnlySet = new Set(args.directOnly ?? []);

  if (shipped.length === 0) {
    throw new Error(
      "total coverage impossible: ship_list yields zero shipped cells",
    );
  }

  const familyIndex: Record<string, number> = {};
  families.forEach((f, i) => (familyIndex[f] = i));
  const styleIndex: Record<string, number> = {};
  styles.forEach((s, i) => (styleIndex[s] = i));
  const shippedSet = new Set(shipped.map((s) => s.cell));

  const redirect: Record<string, string> = {};
  const entries: CoverageEntry[] = [];
  const tierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let manifestCount = 0;
  let fallbackCount = 0;

  for (const fam of families) {
    for (const sty of styles) {
      const from = cellKey(fam, sty);
      if (shippedSet.has(from) || directOnlySet.has(from)) continue;

      const manifestTarget = manifestRedirect[from];
      if (manifestTarget && shippedSet.has(manifestTarget)) {
        redirect[from] = manifestTarget;
        entries.push({
          from,
          to: manifestTarget,
          kind: "manifest",
          tier: 0,
        });
        manifestCount++;
        continue;
      }

      const stance = styleStance[sty];
      const famIdx = familyIndex[fam]!;
      const styIdx = styleIndex[sty]!;
      let best: { key: number[]; cell: string; tier: number } | null = null;

      for (const candidate of shipped) {
        const sameFamily = candidate.family === fam;
        const sameStance = styleStance[candidate.style] === stance;
        let tier: number;
        let primary: number;
        let secondary: number;

        if (sameFamily && sameStance) {
          tier = 1;
          primary = Math.abs(styleIndex[candidate.style]! - styIdx);
          secondary = 0;
        } else if (sameFamily) {
          tier = 2;
          primary = Math.abs(styleIndex[candidate.style]! - styIdx);
          secondary = 0;
        } else if (sameStance) {
          tier = 3;
          primary = Math.abs(familyIndex[candidate.family]! - famIdx);
          secondary = Math.abs(styleIndex[candidate.style]! - styIdx);
        } else {
          tier = 4;
          primary = -candidate.tagCount;
          secondary = 0;
        }

        const key = [tier, primary, secondary, candidate.manifestOrder];
        if (best === null || cmp(key, best.key) < 0) {
          best = { key, cell: candidate.cell, tier };
        }
      }

      redirect[from] = best!.cell;
      entries.push({
        from,
        to: best!.cell,
        kind: "fallback",
        tier: best!.tier,
      });
      tierCounts[best!.tier] = (tierCounts[best!.tier] ?? 0) + 1;
      fallbackCount++;
    }
  }

  const gaps: string[] = [];
  for (const fam of families) {
    for (const sty of styles) {
      const from = cellKey(fam, sty);
      if (shippedSet.has(from) || directOnlySet.has(from)) continue;
      const landed = redirect[from];
      if (!landed || !shippedSet.has(landed)) gaps.push(from);
    }
  }
  if (gaps.length) {
    throw new Error(
      `coverage invariant violated: ${gaps.length} grid cell(s) do not route to a shipped cell: ` +
        `${gaps.slice(0, 12).join(", ")}${gaps.length > 12 ? " ..." : ""}`,
    );
  }

  return {
    redirect,
    entries,
    direct: [...shippedSet].sort(),
    counts: {
      direct: shippedSet.size,
      manifest: manifestCount,
      fallback: fallbackCount,
      tier: tierCounts,
    },
  };
}
