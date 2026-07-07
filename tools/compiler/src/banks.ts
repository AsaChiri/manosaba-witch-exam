/**
 * Tolerant parsers for the three authored banks. These supply DISPLAY TEXT only
 * (stems, option prose, group lines, pick sentences, wanted-lines) + the origin
 * group partitions. All votemaps come from the certified JSON, never from here.
 */
import { readFileSync } from "node:fs";
import {
  normalizeOriginSub,
  normalizeCopingSub,
  familyOfOriginSub,
} from "./taxonomy.js";

export interface BankData {
  /** qid -> stem display text (K.* and O.* slots). */
  stems: Record<string, string>;
  /** qid -> {oid -> option display text}. */
  optionText: Record<string, Record<string, string>>;
  /** family code -> O.C1 wanted-line. */
  wantedLines: Record<string, string>;
  /** origin sub-variant id -> pick sentence. */
  originPickText: Record<string, string>;
  /** coping sub-variant id -> pick sentence. */
  copingPickText: Record<string, string>;
  /** group id -> group line (V.OGROUP option text). */
  groupLine: Record<string, string>;
  /** group id -> {family, members[]}. */
  groups: Record<string, { family: string; members: string[] }>;
  /** fixed pick-screen stems. */
  pickStems: { origin: string; group: string; coping: string };
  warnings: string[];
}

const ARROW = "→"; // →

/** Strip inline markers, vote tails, and emphasis to leave display prose. */
function cleanDisplay(s: string): string {
  let t = s;
  // drop the vote tail: everything from the first " → " on.
  const arrow = t.indexOf(` ${ARROW} `);
  if (arrow >= 0) t = t.slice(0, arrow);
  // drop trailing/inline markers and cross-key notes.
  t = t.replace(/\*\*\[[^\]]*\]\*\*/g, "");
  t = t.replace(/\*\([^)]*cross-stance key[^)]*\)\*/gi, "");
  t = t.replace(/\[(R2-[^\]]*|REPAIR-ADDED[^\]]*)\]/g, "");
  // strip markdown emphasis markers but keep inner text.
  t = t.replace(/\*\*/g, "").replace(/(^|[^*])\*(?!\*)/g, "$1");
  return t.replace(/\s+/g, " ").trim();
}

const OPTION_RE = /^-\s*([A-Za-z])\.\s+(.*)$/;

/** Parse coping OR origin question bank into stems + option texts. */
function parseQuestionBank(
  path: string,
  ns: "K" | "O",
  data: BankData,
): void {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const headerRe = new RegExp(`^\\*\\*\\s*(${ns}\\.[A-Za-z0-9]+)\\b`);
  let cur: string | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const hm = headerRe.exec(line);
    if (hm) {
      cur = hm[1]!;
      data.optionText[cur] ??= {};
      // inline italic stem (coping): take text after the first " — ".
      const dash = line.indexOf(" — ");
      if (dash >= 0) {
        const stem = cleanDisplay(line.slice(dash + 3).replace(/^\*+|\*+$/g, ""));
        if (stem) data.stems[cur] = stem;
      }
      continue;
    }
    if (!cur) continue;
    // origin "Stem: "..."" line
    const sm = /^Stem:\s*"?(.+?)"?\s*$/.exec(line);
    if (sm && ns === "O") {
      data.stems[cur] = cleanDisplay(sm[1]!);
      continue;
    }
    const om = OPTION_RE.exec(line);
    if (om) {
      const oid = om[1]!;
      data.optionText[cur]![oid] = cleanDisplay(om[2]!);
      continue;
    }
    // O.C1 wanted-line table rows: | FAM | line |
    if (cur === "O.C1") {
      const cells = tableCells(line);
      if (cells && cells.length === 2 && /^[A-Z]{2,4}$/.test(cells[0]!)) {
        if (cells[0] !== "Family") data.wantedLines[cells[0]!] = cleanDisplay(cells[1]!);
      }
    }
  }
}

function tableCells(line: string): string[] | null {
  if (!line.startsWith("|")) return null;
  if (/^\|[\s:|-]+\|?$/.test(line)) return null; // separator row
  return line
    .slice(1, line.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((c) => c.trim());
}

/** Parse the pickset bank: pick sentences + origin group partitions. */
function parsePicksetBank(path: string, data: BankData): void {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  type Mode = "none" | "origin" | "coping" | "group";
  let mode: Mode = "none";
  for (const raw of lines) {
    const line = raw.trim();
    if (/^###\s+1\.1\b.*[Oo]rigin axis/.test(line)) mode = "origin";
    else if (/^###\s+1\.2\b.*[Cc]oping axis/.test(line)) mode = "coping";
    else if (/^###\s+1\.3\b.*[Gg]roup bank/.test(line)) mode = "group";
    else if (/^###\s+2\b/.test(line) || /^##\s+2\b/.test(line)) mode = "none";

    const cells = tableCells(line);
    if (!cells) continue;
    if (mode === "group" && cells.length >= 4 && /^[A-Z]+-G\d+$/.test(cells[0]!)) {
      const gid = cells[0]!;
      const members = cells[2]!
        .split(",")
        .map((m) => normalizeOriginSub(m))
        .filter(Boolean);
      data.groups[gid] = { family: gid.split("-")[0]!, members };
      data.groupLine[gid] = cleanDisplay(cells[3]!);
    } else if (mode === "origin" && cells.length === 2 && /^[A-Za-z]+-\d+$/.test(cells[0]!)) {
      data.originPickText[normalizeOriginSub(cells[0]!)] = cleanDisplay(cells[1]!);
    } else if (mode === "coping" && cells.length === 2 && /^[A-Za-z]+-\d+$/.test(cells[0]!)) {
      data.copingPickText[normalizeCopingSub(cells[0]!)] = cleanDisplay(cells[1]!);
    }
  }
}

export function parseBanks(paths: {
  copingBank: string;
  originBank: string;
  picksetBank: string;
}): BankData {
  const data: BankData = {
    stems: {},
    optionText: {},
    wantedLines: {},
    originPickText: {},
    copingPickText: {},
    groupLine: {},
    groups: {},
    pickStems: {
      origin: "Which of these do you know from the inside? Pick the one that is most yours.",
      group: "Which of these is closest to how it was for you? Pick the nearest.",
      coping: "Which of these is most you?",
    },
    warnings: [],
  };
  parseQuestionBank(paths.copingBank, "K", data);
  parseQuestionBank(paths.originBank, "O", data);
  parsePicksetBank(paths.picksetBank, data);
  // sanity: family wanted-lines should cover all 8
  for (const f of ["ABN", "ED", "MB", "DEF", "ALN", "FAI", "VC", "POW"]) {
    if (!data.wantedLines[f]) data.warnings.push(`O.C1 wanted-line missing for ${f}`);
  }
  void familyOfOriginSub;
  return data;
}
