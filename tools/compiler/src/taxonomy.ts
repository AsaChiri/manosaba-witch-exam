/** Frozen taxonomy maps (phase0_taxonomy_freeze.md) + id normalization. */

/** Full origin-family name -> code (names carry " / " which is NOT a delimiter). */
export const FAMILY_NAME_TO_CODE: Record<string, string> = {
  Abandonment: "ABN",
  "Mistrust / Betrayal": "MB",
  "Emotional Deprivation": "ED",
  "Defectiveness / Shame": "DEF",
  Alienation: "ALN",
  "Failure / Inadequacy": "FAI",
  "Vulnerability / Catastrophe": "VC",
  "Powerlessness / Dependence": "POW",
};
export const FAMILY_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(FAMILY_NAME_TO_CODE).map(([k, v]) => [v, k]),
);

/** Coping style name -> style code (canonical, as every source writes it). */
export const STYLE_NAME_TO_CODE: Record<string, string> = {
  Detacher: "DT",
  "Self-Soother": "SS",
  "Thrill-Seeker": "TS",
  Avoider: "AV",
  Concealer: "CO",
  "Self-Reliant": "SR",
  Resigned: "RS",
  "Self-Punisher": "SP",
  Ruminator: "RU",
  Doomer: "DM",
  Pleaser: "PL",
  Caretaker: "CT",
  Clinger: "CL",
  Depender: "DP",
  Striker: "ST",
  "Wall-of-Anger": "WA",
  Trickster: "TR",
  Avenger: "AG",
  Sovereign: "SV",
  // Performer is P, not PE — every source writes P-1..P-5 (the frozen
  // ed_subvariants.md §2, the pickset bank, the authoring manifest, and the card
  // frontmatter). "PE" was a compiler-only invention that the removed
  // COPING_CODE_ALIAS laundered P->PE, leaking a code no source ever used into
  // every compiled tag. Codes are matched whole (split on the dash), so P never
  // collides with PF/PL.
  Performer: "P",
  Fantasist: "FA",
  Perfectionist: "PF",
  Ritualist: "RI",
  Watcher: "WT",
  Catastrophizer: "CA",
};
export const STYLE_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STYLE_NAME_TO_CODE).map(([k, v]) => [v, k]),
);

/**
 * Normalize a coping sub-variant id (e.g. "p 1" -> "P-1") — formatting only
 * (case + spacing). There is NO dialect translation: COPING_CODE_ALIAS was
 * removed 2026-07-12, so a code means exactly what the source wrote.
 *
 * An unrecognized code is a hard error, not a pass-through — that error is what
 * replaces the alias. Silently accepting one would derive a tag nothing routes
 * to: the alias used to rewrite the sources' P-2 into PE-2, so every compiled
 * tag, pickset and neighbor entry carried a "PE" code that no source ever used.
 */
export function normalizeCopingSub(id: string): string {
  const raw = id.trim();
  const m = /^([A-Za-z]+)\s*-?\s*(\d+)$/.exec(raw);
  if (!m) return raw;
  const code = m[1]!.toUpperCase();
  if (!STYLE_CODE_TO_NAME[code]) {
    throw new Error(
      `unknown coping style code "${code}" in sub-variant "${raw}" — ` +
        `sources must use canonical codes (${Object.values(STYLE_NAME_TO_CODE).join(", ")})`,
    );
  }
  return `${code}-${m[2]}`;
}

/** Normalize an origin sub-variant id (family codes are already canonical). */
export function normalizeOriginSub(id: string): string {
  const m = /^([A-Za-z]+)\s*-?\s*(\d+)$/.exec(id.trim());
  if (!m) return id.trim();
  return `${m[1]!.toUpperCase()}-${m[2]}`;
}

/** origin sub-variant id -> family code (prefix). */
export function familyOfOriginSub(id: string): string {
  const m = /^([A-Za-z]+)/.exec(id);
  return m ? m[1]!.toUpperCase() : "";
}

/** coping sub-variant id -> style name (via normalized code). Throws (via
 *  normalizeCopingSub) on an unknown code, so a malformed character/card tag
 *  fails the compile loudly rather than deriving a cell nothing routes to. */
export function styleOfCopingSub(id: string): string {
  const norm = normalizeCopingSub(id);
  const m = /^([A-Za-z]+)/.exec(norm);
  const code = m ? m[1]! : "";
  return STYLE_CODE_TO_NAME[code] ?? code;
}

/** numeric suffix used as the file-index adjacency (listing order). */
export function subIndex(id: string): number {
  const m = /(\d+)\s*$/.exec(id);
  return m ? parseInt(m[1]!, 10) : 0;
}
