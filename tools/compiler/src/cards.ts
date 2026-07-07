/**
 * Card parser. Card identity (cell + sub-variants + variant index) is taken from
 * a KNOWN_CARDS registry distilled from output/cards/README.md — the authored
 * manifest blocks drift badly across pilots/batch-1 (bold vs plain keys, bracket
 * vs numeric tags, missing headers) and the registry is the reliable normalizer.
 * The five prose fields are parsed tolerantly from each file's locale sections.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeOriginSub, normalizeCopingSub } from "./taxonomy.js";

export interface CardFields {
  epithet: string;
  magic: string;
  crime: string[];
  execution: string[];
  epitaph: string;
}
export interface ParsedCard {
  sourceId: string;
  file: string;
  family: string;
  style: string;
  originSub: string;
  copingSub: string;
  variant: number; // 1-based authored variant index (vN of vN/M)
  locales: Record<string, CardFields>; // en, ja, zh-CN
  warnings: string[];
}

interface KnownCard {
  family: string;
  style: string;
  originSub: string;
  copingSub: string;
  variant: number;
}

/** Distilled from output/cards/README.md status tables (recon-verified). */
export const KNOWN_CARDS: Record<string, KnownCard> = {
  card_01_ed1_spotlight: { family: "ED", style: "Performer", originSub: "ED-1", copingSub: "PE-1", variant: 1 },
  card_02_ed2_jester: { family: "ED", style: "Performer", originSub: "ED-2", copingSub: "PE-2", variant: 1 },
  card_03_ed5_prodigy: { family: "ED", style: "Performer", originSub: "ED-5", copingSub: "PE-3", variant: 1 },
  card_04_awkward_mb_depender: { family: "MB", style: "Depender", originSub: "MB-3", copingSub: "DP-1", variant: 1 },
  card_05_ed9_spotlight: { family: "ED", style: "Performer", originSub: "ED-9", copingSub: "PE-1", variant: 1 },
  card_06_abn1_sentinel: { family: "ABN", style: "Clinger", originSub: "ABN-1", copingSub: "CL-1", variant: 1 },
  card_07_vc1_lookout: { family: "VC", style: "Watcher", originSub: "VC-1", copingSub: "WT-1", variant: 1 },
  "DEF-SP-001": { family: "DEF", style: "Self-Punisher", originSub: "DEF-3", copingSub: "SP-1", variant: 1 },
  "ALN-AV-001": { family: "ALN", style: "Avoider", originSub: "ALN-1", copingSub: "AV-1", variant: 1 },
  "ED-SS-001": { family: "ED", style: "Self-Soother", originSub: "ED-1", copingSub: "SS-1", variant: 1 },
  "FAI-AV-001": { family: "FAI", style: "Avoider", originSub: "FAI-1", copingSub: "AV-3", variant: 1 },
  "ALN-FA-001": { family: "ALN", style: "Fantasist", originSub: "ALN-10", copingSub: "FA-2", variant: 1 },
  "ABN-CL-001": { family: "ABN", style: "Clinger", originSub: "ABN-1", copingSub: "CL-1", variant: 2 },
  "MB-WT-001": { family: "MB", style: "Watcher", originSub: "MB-10", copingSub: "WT-2", variant: 1 },
};

const LOCALE_HEADERS: { locale: string; re: RegExp }[] = [
  { locale: "en", re: /^##\s+EN(\s+card)?\s*$/i },
  { locale: "ja", re: /^##\s+JA\s*$/i },
  { locale: "zh-CN", re: /^##\s+ZH\s*$/i },
];

type Field = keyof CardFields;

function classify(bold: string): Field | null {
  if (/原罪/.test(bold) || /\bEpithet\b/i.test(bold)) return "epithet";
  if (/魔法/.test(bold) || /\bMagic\b/i.test(bold)) return "magic";
  if (/処刑|处刑/.test(bold) || /\bExecution\b/i.test(bold)) return "execution";
  if (/銘|铭/.test(bold) || /\bEpitaph\b/i.test(bold)) return "epitaph";
  if (/罪/.test(bold) || /\bCrime\b/i.test(bold)) return "crime"; // after 原罪
  return null;
}

function cleanValue(s: string): string {
  return s
    .replace(/^\s*-\s+/, "") // bullet
    .replace(/^[\s:：—\-·]+/, "") // leading separators
    .replace(/\*\*/g, "")
    .replace(/^\*+|\*+$/g, "")
    .trim();
}

function parseSection(lines: string[]): CardFields {
  const fields: CardFields = { epithet: "", magic: "", crime: [], execution: [], epitaph: "" };
  let cur: Field | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (!cur) {
      buf = [];
      return;
    }
    const cleaned = buf.map(cleanValue).filter((x) => x.length > 0);
    if (cur === "crime" || cur === "execution") fields[cur] = cleaned;
    else (fields[cur] as string) = cleaned.join(" ");
    buf = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("# ")) {
      flush();
      cur = null;
      continue;
    }
    if (/^---+$/.test(line)) {
      flush();
      cur = null;
      continue;
    }
    const bm = /^\*\*(.+?)\*\*(.*)$/.exec(line);
    if (bm) {
      const field = classify(bm[1]!);
      if (field) {
        flush();
        cur = field;
        const rest = cleanValue(bm[2]!);
        if (rest) buf.push(rest);
        continue;
      }
    }
    if (cur && line.length > 0) buf.push(line);
  }
  flush();
  return fields;
}

export function parseCard(sourceId: string, cardsDir: string): ParsedCard {
  const known = KNOWN_CARDS[sourceId];
  const warnings: string[] = [];
  const file = join(cardsDir, `${sourceId}.md`);
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  // locate locale section headers
  const marks: { locale: string; idx: number }[] = [];
  lines.forEach((l, i) => {
    for (const { locale, re } of LOCALE_HEADERS) {
      if (re.test(l.trim())) marks.push({ locale, idx: i });
    }
  });
  const locales: Record<string, CardFields> = {};
  for (let m = 0; m < marks.length; m++) {
    const start = marks[m]!.idx + 1;
    const end = m + 1 < marks.length ? marks[m + 1]!.idx : lines.length;
    locales[marks[m]!.locale] = parseSection(lines.slice(start, end));
  }
  for (const loc of ["en", "ja", "zh-CN"]) {
    if (!locales[loc]) warnings.push(`${sourceId}: missing ${loc} section`);
  }

  const id = known ?? deriveFromFile();
  return {
    sourceId,
    file,
    family: id.family,
    style: id.style,
    originSub: normalizeOriginSub(id.originSub),
    copingSub: normalizeCopingSub(id.copingSub),
    variant: id.variant,
    locales,
    warnings,
  };

  function deriveFromFile(): KnownCard {
    warnings.push(`${sourceId}: not in KNOWN_CARDS registry; identity may be wrong`);
    return { family: "?", style: "?", originSub: "?-0", copingSub: "?-0", variant: 1 };
  }
}
