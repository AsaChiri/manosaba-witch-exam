/**
 * Extracts the §3 THIN-cell routing table from the ultimate design source,
 * authoring_manifest.md. Family names contain " / ", so the U+00D7 sign is the
 * only cell-label delimiter.
 */
import { readFileSync } from "node:fs";
import { cellKey } from "@manosaba/witch-exam-engine";
import { FAMILY_NAME_TO_CODE } from "./taxonomy.js";

const TIMES = "×";

export interface RedirectEntry {
  fromKey: string;
  toKey: string;
  fromLabel: string;
  toLabel: string;
}

function parseCellLabel(
  label: string,
): { family: string; style: string } | null {
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
  const lines = readFileSync(manifestPath, "utf8").split(/\r?\n/);
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
    if (inSection && /^##\s+\d/.test(line)) break;
    if (!inSection || !line.startsWith("|")) continue;
    if (/^\|[\s:|-]+\|?$/.test(line)) continue;

    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (/THIN cell/i.test(cells[0]!) || /routes to/i.test(cells[1]!)) {
      continue;
    }

    const from = parseCellLabel(cells[0]!);
    const to = parseCellLabel(cells[1]!);
    if (!from || !to) {
      warnings.push(`unparsed redirect row: ${cells[0]} -> ${cells[1]}`);
      continue;
    }

    const fromKey = cellKey(from.family, from.style);
    const toKey = cellKey(to.family, to.style);
    redirect[fromKey] = toKey;
    entries.push({
      fromKey,
      toKey,
      fromLabel: cells[0]!,
      toLabel: cells[1]!,
    });
  }

  if (!inSection || entries.length === 0) {
    throw new Error(
      `THIN-cell routing rules not found in ${manifestPath}`,
    );
  }
  return { redirect, entries, warnings };
}
