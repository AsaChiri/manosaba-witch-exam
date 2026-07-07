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

/** Coping style name -> 2-letter code (Performer is canonical PE, source P). */
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
  Performer: "PE",
  Fantasist: "FA",
  Perfectionist: "PF",
  Ritualist: "RI",
  Watcher: "WT",
  Catastrophizer: "CA",
};
export const STYLE_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STYLE_NAME_TO_CODE).map(([k, v]) => [v, k]),
);

/** Legacy / source coping-code aliases -> canonical code. */
const COPING_CODE_ALIAS: Record<string, string> = {
  P: "PE", // Performer (source ed_subvariants.md keeps P-1..P-5)
  D: "DP", // card_04 wrote Depender/Porcelain as D-
  W: "WT", // card_07 wrote Watcher/Lookout as W-
};

/** Normalize a coping sub-variant id (e.g. "P-1" -> "PE-1"). */
export function normalizeCopingSub(id: string): string {
  const m = /^([A-Za-z]+)\s*-?\s*(\d+)$/.exec(id.trim());
  if (!m) return id.trim();
  const code = COPING_CODE_ALIAS[m[1]!] ?? m[1]!;
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

/** coping sub-variant id -> style name (via normalized code). */
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
