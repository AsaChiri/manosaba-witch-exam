/**
 * Total cell-coverage map (design spec §5 — "EVERY cell must resolve
 * deterministically to the nearest SHIPPED tag").
 *
 * The runtime session (packages/engine/src/session.ts `tail()`) resolves a
 * scored cell to a served card as:
 *
 *     landedKey = picksets.redirect[rawCell] ?? rawCell
 *     pickset   = picksets.cells[landedKey]        // throws if absent
 *
 * `picksets.cells` only ever contains SHIPPED cells (cells with >=1 authored
 * card). So with a partial corpus a session only reaches a card when either the
 * scored cell is itself shipped, or the redirect map routes it to a shipped
 * cell. The old emission shipped only the 15 authorial THIN-cell routes, most of
 * whose targets are themselves unshipped — so ~94% of walks dead-ended.
 *
 * This module recomputes, from the current ship list on every compile, a TOTAL
 * map: every one of the 8x25 grid cells that is not itself shipped-covered is
 * routed to a shipped cell, so the coverage invariant (every cell reaches a
 * shipped tag) always holds and self-heals as the ship list grows. The session
 * marks these as `redirectedCell` so the UI can show the quiet archival note.
 *
 * Ranking tiers (nearest shipped cell), best first:
 *   1  same origin family + same coping stance
 *   2  same origin family (any stance)
 *   3  same coping stance (nearest family)
 *   4  global default — the shipped cell with the highest density (most tags)
 *
 * Within a tier: order by coping file-index adjacency distance (the frozen
 * taxonomy listing order, `taxonomy.ts`), tie-broken by fixed manifest order.
 * Tier 3 refines by nearest family first (its defining criterion), then coping
 * adjacency, then manifest order. Tier 4 refines by density, then manifest
 * order. Authorial §3 routes are preserved verbatim when their target is
 * shipped (they encode intent); otherwise the source is re-routed per the tiers.
 */
import { cellKey } from "@manosaba/witch-exam-engine";

/** A shipped cell: a grid cell with >=1 authored/shipped card. */
export interface ShippedCellInfo {
  /** cellKey (`${family}|${style}`). */
  cell: string;
  /** origin family code (e.g. "ED"). */
  family: string;
  /** coping style name (e.g. "Performer"). */
  style: string;
  /** number of authored tags in the cell (its "density"). */
  tagCount: number;
  /** fixed manifest order for deterministic tie-breaking (lower = earlier). */
  manifestOrder: number;
}

export interface CoverageEntry {
  from: string;
  to: string;
  /** "manifest" = retained authorial §3 route; "fallback" = computed. */
  kind: "manifest" | "fallback";
  /** 0 for manifest routes; 1..4 for fallback routes. */
  tier: number;
}

export interface CoverageResult {
  /** total redirect map: every non-shipped grid cell -> a shipped cell key. */
  redirect: Record<string, string>;
  entries: CoverageEntry[];
  /** shipped (direct) cell keys, sorted. */
  direct: string[];
  counts: {
    direct: number;
    manifest: number;
    fallback: number;
    /** fallback-route distribution over tiers 1..4. */
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

/**
 * Compute the total coverage map over the full `families x styles` grid.
 *
 * Throws if the ship list yields zero shipped cells (total coverage is then
 * impossible) or if — as a defensive post-condition — any grid cell fails to
 * resolve to a shipped cell.
 */
export function buildCoverageMap(args: {
  /** origin family codes, frozen listing order. */
  families: string[];
  /** coping style names, frozen listing order (taxonomy freeze). */
  styles: string[];
  /** style name -> coping stance (from the certified coping tree). */
  styleStance: Record<string, string>;
  /** shipped cells derived from the ship list. */
  shipped: ShippedCellInfo[];
  /** authorial §3 THIN-cell routes: fromCellKey -> toCellKey. */
  manifestRedirect: Record<string, string>;
  /**
   * Cells that must NOT be redirected but are NOT normal-card cells either —
   * the special character cells (§3.7) that self-provide coverage. They are
   * "direct" (a session landing here reaches the cell's own pickset/neighbor,
   * so the exact character tag can be served), yet they are deliberately kept
   * OUT of the redirect-target candidate set: no other cell should route INTO
   * a character-only cell, because it has no normal card to show a redirected
   * (or non-spoiler) arrival. Cells that also hold a normal card belong in
   * `shipped`, not here.
   */
  directOnly?: string[];
}): CoverageResult {
  const { families, styles, styleStance, shipped, manifestRedirect } = args;
  const directOnlySet = new Set(args.directOnly ?? []);

  if (shipped.length === 0) {
    throw new Error(
      "total coverage impossible: ship_list yields zero shipped cells (add at least one card to ship_list.json)",
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
      // direct — no redirect entry (a shipped normal-card cell, or a character
      // cell that self-provides coverage per §3.7).
      if (shippedSet.has(from) || directOnlySet.has(from)) continue;

      // 1) authorial intent: keep a §3 route iff its target is a shipped cell.
      const mTarget = manifestRedirect[from];
      if (mTarget && shippedSet.has(mTarget)) {
        redirect[from] = mTarget;
        entries.push({ from, to: mTarget, kind: "manifest", tier: 0 });
        manifestCount++;
        continue;
      }

      // 2) fallback: nearest shipped cell by the tier ranking.
      const stance = styleStance[sty];
      const famIdx = familyIndex[fam]!;
      const styIdx = styleIndex[sty]!;
      let best: { key: number[]; cell: string; tier: number } | null = null;
      for (const sc of shipped) {
        const sameFamily = sc.family === fam;
        const sameStance = styleStance[sc.style] === stance;
        let tier: number;
        let primary: number;
        let secondary: number;
        if (sameFamily && sameStance) {
          tier = 1;
          primary = Math.abs(styleIndex[sc.style]! - styIdx); // coping adjacency
          secondary = 0;
        } else if (sameFamily) {
          tier = 2;
          primary = Math.abs(styleIndex[sc.style]! - styIdx); // coping adjacency
          secondary = 0;
        } else if (sameStance) {
          tier = 3;
          primary = Math.abs(familyIndex[sc.family]! - famIdx); // nearest family
          secondary = Math.abs(styleIndex[sc.style]! - styIdx); // then coping adjacency
        } else {
          tier = 4;
          primary = -sc.tagCount; // global default: highest density wins
          secondary = 0;
        }
        const key = [tier, primary, secondary, sc.manifestOrder];
        if (best === null || cmp(key, best.key) < 0) {
          best = { key, cell: sc.cell, tier };
        }
      }
      redirect[from] = best!.cell;
      entries.push({ from, to: best!.cell, kind: "fallback", tier: best!.tier });
      tierCounts[best!.tier] = (tierCounts[best!.tier] ?? 0) + 1;
      fallbackCount++;
    }
  }

  // Post-condition: total coverage is an invariant — every grid cell resolves
  // deterministically. A cell is covered when it is a shipped normal-card cell,
  // a character-only direct cell (§3.7 — served by its own pickset), or it
  // redirects to a shipped cell.
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
      `coverage invariant violated: ${gaps.length} grid cell(s) do not route to a shipped cell: ${gaps.slice(0, 12).join(", ")}${gaps.length > 12 ? " ..." : ""}`,
    );
  }

  const direct = [...shippedSet].sort();
  return {
    redirect,
    entries,
    direct,
    counts: {
      direct: direct.length,
      manifest: manifestCount,
      fallback: fallbackCount,
      tier: tierCounts,
    },
  };
}
