/**
 * Card parser. Card identity (family/style + sub-variants + variant index) is
 * read from each file's `schema: card-source/v1` YAML frontmatter — every card
 * now self-labels, so there is no registry to drift out of sync. A shipped card
 * missing those fields is a hard error (no `?` placeholder fallback).
 * The five prose fields are parsed tolerantly from each file's locale sections.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeOriginSub, normalizeCopingSub } from "./taxonomy.js";

export interface MagicField {
  name: string; // REQUIRED for shipping — compile hard-fails on empty (user invariant 2026-07-08)
  text: string;
}
export interface CardFields {
  epithet: string;
  magic: MagicField;
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

/** Strip wrapping quotes from a scalar frontmatter value (values are unquoted in
 *  practice; this is defensive). */
function stripQuotes(s: string): string {
  return s.replace(/^["'](.*)["']$/, "$1").trim();
}

/** Read the leading `--- … ---` YAML frontmatter. Only the flat scalar fields and
 *  the one-level `magic_name:` map are needed for card identity + headline, so the
 *  parser stays deliberately small rather than pulling in a YAML dependency. */
function parseFrontmatter(lines: string[]): { fields: Record<string, string>; magicName: Record<string, string> } {
  const fields: Record<string, string> = {};
  const magicName: Record<string, string> = {};
  if (lines[0]?.trim() !== "---") return { fields, magicName };
  let inMagic = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") break;
    if (/^\s/.test(line)) {
      // indented child — only magic_name's locale entries are consumed
      const child = /^\s+([\w-]+):\s*(.*)$/.exec(line);
      if (inMagic && child) magicName[child[1]!] = stripQuotes(child[2]!);
      continue;
    }
    inMagic = false;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === "magic_name") inMagic = true;
    else fields[m[1]!] = m[2]!.trim();
  }
  return { fields, magicName };
}

/** The magic NAME is authoritative from frontmatter; the prose still opens with it
 *  (`Given Hours — …` / `**魔法**：「传功」——…` / `「技渡し」——…`). Strip that leading
 *  `[quote]name[reading?][quote] <dash/colon>` so magic.text carries only the
 *  description. The optional reading tolerates a furigana gloss the prose may hang
 *  on the name (`「文字復元(もじふくげん)」——…`) that the YAML name omits. */
function stripLeadingName(text: string, name: string): string {
  if (!name) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reading = "(?:[(（][^)）]*[)）])?"; // optional furigana / pronunciation gloss
  const re = new RegExp(`^\\s*["'“「『]?\\s*${esc}\\s*${reading}\\s*["'”」』]?\\s*(?:——|――|—|–|-|:|：)\\s*`);
  const out = text.replace(re, "").trim();
  return out.length ? out : text;
}

function parseSection(lines: string[]): CardFields {
  const fields: CardFields = { epithet: "", magic: { name: "", text: "" }, crime: [], execution: [], epitaph: "" };
  let cur: Field | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (!cur) {
      buf = [];
      return;
    }
    const cleaned = buf.map(cleanValue).filter((x) => x.length > 0);
    if (cur === "crime" || cur === "execution") fields[cur] = cleaned;
    // magic name comes from frontmatter (set in parseCard); here we only keep the
    // prose value as text — the leading name is stripped once the name is known.
    else if (cur === "magic") fields.magic = { name: "", text: cleaned.join(" ") };
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
  const warnings: string[] = [];
  const file = join(cardsDir, `${sourceId}.md`);
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  // identity + headline names are self-declared in the card's YAML frontmatter
  const { fields, magicName } = parseFrontmatter(lines);
  const missing = (["family", "style", "origin_sub", "coping_sub"] as const).filter((k) => !fields[k]);
  if (missing.length) {
    throw new Error(
      `${sourceId}: identity frontmatter incomplete — missing ${missing.join(", ")}. ` +
        "Every card must self-label family/style/origin_sub/coping_sub in its --- block.",
    );
  }
  const originSub = normalizeOriginSub(fields.origin_sub!);
  const copingSub = normalizeCopingSub(fields.coping_sub!);
  const variantRaw = parseInt(fields.variant ?? "1", 10);
  const variant = Number.isFinite(variantRaw) && variantRaw > 0 ? variantRaw : 1;
  const derivedTag = `${originSub}_${copingSub}`;
  if (fields.tag && fields.tag !== derivedTag) {
    warnings.push(`${sourceId}: frontmatter tag "${fields.tag}" != derived "${derivedTag}"`);
  }

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
    const f = locales[loc];
    if (!f) {
      warnings.push(`${sourceId}: missing ${loc} section`);
      continue;
    }
    // magic name is authoritative from frontmatter; strip it off the prose text
    const name = magicName[loc] ?? "";
    if (!name) warnings.push(`${sourceId}: frontmatter magic_name.${loc} missing`);
    f.magic = { name, text: stripLeadingName(f.magic.text, name) };
  }

  return { sourceId, file, family: fields.family!, style: fields.style!, originSub, copingSub, variant, locales, warnings };
}
