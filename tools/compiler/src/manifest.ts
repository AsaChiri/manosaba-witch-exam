/**
 * Extracts the §3 THIN-cell "route-to-nearest" redirect table from
 * authoring_manifest.md (scorer-spec repair item R-12). Cells are named
 * "<Full Family Name> × <Style Name>" with a U+00D7 separator; family names
 * contain " / " which is NOT a delimiter, so we split on " × " only.
 */
import { readFileSync } from "node:fs";
import { FAMILY_NAME_TO_CODE } from "./taxonomy.js";
import { cellKey } from "@manosaba/witch-exam-engine";

const TIMES = "×";

export interface RedirectEntry {
  fromKey: string;
  toKey: string;
  fromLabel: string;
  toLabel: string;
}

function parseCellLabel(label: string): { family: string; style: string } | null {
  const idx = label.indexOf(TIMES);
  if (idx < 0) return null;
  const familyName = label.slice(0, idx).trim();
  const style = label.slice(idx + 1).trim();
  const family = FAMILY_NAME_TO_CODE[familyName];
  if (!family) return null;
  return { family, style };
}

export function parseRedirectMap(manifestPath: string): {
  redirect: Record<string, string>;
  entries: RedirectEntry[];
  warnings: string[];
} {
  const text = readFileSync(manifestPath, "utf8");
  const lines = text.split(/\r?\n/);
  const redirect: Record<string, string> = {};
  const entries: RedirectEntry[] = [];
  const warnings: string[] = [];

  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^##\s+3\.\s+THIN-cell routing/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+\d/.test(line)) break; // next H2 ends the section
    if (!inSection) continue;
    if (!line.startsWith("|")) continue;
    if (/^\|[\s:|-]+\|?$/.test(line)) continue; // separator
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    if (/THIN cell/i.test(cells[0]!) || /routes to/i.test(cells[1]!)) continue; // header
    const from = parseCellLabel(cells[0]!);
    const to = parseCellLabel(cells[1]!);
    if (!from || !to) {
      warnings.push(`unparsed redirect row: ${cells[0]} -> ${cells[1]}`);
      continue;
    }
    const fromKey = cellKey(from.family, from.style);
    const toKey = cellKey(to.family, to.style);
    redirect[fromKey] = toKey;
    entries.push({ fromKey, toKey, fromLabel: cells[0]!, toLabel: cells[1]! });
  }
  return { redirect, entries, warnings };
}
