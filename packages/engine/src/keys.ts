/**
 * Canonical string keys shared by the engine and the compiler, so both sides
 * index cells / pairs identically. A cell is `${familyCode}|${styleName}`
 * (e.g. `DEF|Performer`); a picked sub-variant pair is `${originSub}|${copingSub}`.
 * `|` is safe: no family code, style name, or sub-variant id contains it.
 */
export const cellKey = (family: string, style: string): string =>
  `${family}|${style}`;

export const pickPairKey = (originSub: string, copingSub: string): string =>
  `${originSub}|${copingSub}`;

export function parseCellKey(key: string): { family: string; style: string } {
  const i = key.indexOf("|");
  return { family: key.slice(0, i), style: key.slice(i + 1) };
}
