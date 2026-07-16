/**
 * Character parser for the 13 special character records (design spec §3.7).
 * Sources live in <workspace>/output/characters/<id>.md — YAML frontmatter
 * (id / tag / color scalars + one-level `name:` / `magic_name:` locale maps)
 * and ## EN / ## JA / ## ZH sections carrying the two 覚醒前/覚醒後 fields.
 * zh-TW is derived from zh-CN at emission (same OpenCC pipeline as cards).
 *
 * Gating is all-or-nothing via ship_list.json's top-level `"characters"` flag —
 * a partially shipped cast would be a broken feature, so there is no per-id
 * allowlist. Validation is strict on shape (the cast is closed canon: exactly
 * 13, unique ids/tags, plain-hex colors — html2canvas needs plain hex) but only
 * WARNS when a tag is not yet shipped: dormant characters are expected while
 * the corpus grows toward the canonical wound tags.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const CHARACTER_LOCALES = ["en", "ja", "zh-CN"] as const;
export const CHARACTER_CAST_SIZE = 13;

export interface CharacterFields {
  before: string;
  after: string;
  /** The character's 原罪 — shown as the record's epithet field. */
  epithet: string;
  /** The character's artbook signature quote — the record's closing line. */
  quote: string;
  /** Per-character warden remark (典獄長). Required in every authored locale —
   *  there is no generic fallback template. */
  warden: string;
}
export interface ParsedCharacter {
  id: string;
  file: string;
  tag: string;
  color: string;
  name: Record<string, string>; // en, ja, zh-CN
  magicName: Record<string, string>; // en, ja, zh-CN
  locales: Record<string, CharacterFields>; // en, ja, zh-CN
}

const LOCALE_HEADERS: { locale: string; re: RegExp }[] = [
  { locale: "en", re: /^##\s+EN\s*$/i },
  { locale: "ja", re: /^##\s+JA\s*$/i },
  { locale: "zh-CN", re: /^##\s+ZH\s*$/i },
];

function classify(bold: string): keyof CharacterFields | null {
  if (/覚醒前|觉醒前|\bBefore\b/i.test(bold)) return "before";
  if (/覚醒後|觉醒后|\bAfter\b/i.test(bold)) return "after";
  if (/原罪|\bEpithet\b/i.test(bold)) return "epithet";
  if (/台詞|台词|\bQuote\b/i.test(bold)) return "quote";
  if (/典獄長|典狱长|\bWarden\b/i.test(bold)) return "warden";
  return null;
}

function cleanValue(s: string): string {
  return s
    .replace(/^[\s:：—\-·]+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function stripQuotes(s: string): string {
  return s.replace(/^["'](.*)["']$/, "$1").trim();
}

/** Frontmatter: flat scalars + the one-level `name:` / `magic_name:` maps. */
function parseFrontmatter(lines: string[]): {
  fields: Record<string, string>;
  name: Record<string, string>;
  magicName: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  const name: Record<string, string> = {};
  const magicName: Record<string, string> = {};
  if (lines[0]?.trim() !== "---") return { fields, name, magicName };
  let inMap: Record<string, string> | null = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") break;
    if (/^\s/.test(line)) {
      const child = /^\s+([\w-]+):\s*(.*)$/.exec(line);
      if (inMap && child) inMap[child[1]!] = stripQuotes(child[2]!);
      continue;
    }
    inMap = null;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === "name") inMap = name;
    else if (m[1] === "magic_name") inMap = magicName;
    else fields[m[1]!] = stripQuotes(m[2]!.trim());
  }
  return { fields, name, magicName };
}

function parseSection(lines: string[]): CharacterFields {
  const out: CharacterFields = { before: "", after: "", epithet: "", quote: "", warden: "" };
  let cur: keyof CharacterFields | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur) out[cur] = buf.map(cleanValue).filter((x) => x.length > 0).join(" ");
    buf = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("# ") || /^---+$/.test(line)) {
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
  return out;
}

export function parseCharacter(sourceId: string, charactersDir: string): ParsedCharacter {
  const file = join(charactersDir, `${sourceId}.md`);
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);

  const { fields, name, magicName } = parseFrontmatter(lines);

  const marks: { locale: string; idx: number }[] = [];
  lines.forEach((l: string, i: number) => {
    for (const { locale, re } of LOCALE_HEADERS) {
      if (re.test(l.trim())) marks.push({ locale, idx: i });
    }
  });
  const locales: Record<string, CharacterFields> = {};
  for (let m = 0; m < marks.length; m++) {
    const start = marks[m]!.idx + 1;
    const end = m + 1 < marks.length ? marks[m + 1]!.idx : lines.length;
    locales[marks[m]!.locale] = parseSection(lines.slice(start, end));
  }

  return {
    id: fields.id ?? sourceId,
    file,
    tag: fields.tag ?? "",
    color: fields.color ?? "",
    name,
    magicName,
    locales,
  };
}

/** All character source ids present in the directory (basename sans .md). */
export function listCharacterIds(charactersDir: string): string[] {
  return readdirSync(charactersDir)
    .filter((f: string) => f.endsWith(".md"))
    .map((f: string) => f.slice(0, -3))
    .sort();
}

/**
 * Strict shape validation (throws via returned errors) + dormancy warnings.
 * `shippedTags` is the compiled manifest tag list — a character tag outside it
 * is unreachable as a result tag and therefore dormant (warning, not error).
 */
export function validateCharacters(
  chars: ParsedCharacter[],
  shippedTags: ReadonlySet<string>,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (chars.length !== CHARACTER_CAST_SIZE) {
    errors.push(
      `character cast must be exactly ${CHARACTER_CAST_SIZE}, found ${chars.length} — the cast is closed canon`,
    );
  }
  const ids = new Set<string>();
  const tagOwners = new Map<string, string>();
  for (const c of chars) {
    if (ids.has(c.id)) errors.push(`${c.id}: duplicate character id`);
    ids.add(c.id);

    if (!/^[A-Z]+-\d+_[A-Z]+-\d+$/.test(c.tag)) {
      errors.push(`${c.id}: tag "${c.tag}" is not a valid card tag (expected e.g. ED-1_P-1)`);
    } else if (tagOwners.has(c.tag)) {
      errors.push(`${c.id}: tag ${c.tag} already assigned to ${tagOwners.get(c.tag)} — character tags must be unique`);
    } else {
      tagOwners.set(c.tag, c.id);
      if (!shippedTags.has(c.tag)) {
        warnings.push(`${c.id}: tag ${c.tag} is not shipped yet — character stays dormant until its exact card ships`);
      }
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(c.color)) {
      errors.push(`${c.id}: color "${c.color}" must be a plain #rrggbb hex (html2canvas export constraint)`);
    }
    for (const loc of CHARACTER_LOCALES) {
      if (!c.name[loc]) errors.push(`${c.id}: frontmatter name.${loc} missing`);
      if (!c.magicName[loc]) errors.push(`${c.id}: frontmatter magic_name.${loc} missing`);
      const f = c.locales[loc];
      if (!f?.before) errors.push(`${c.id}: ${loc} 覚醒前 text missing`);
      if (!f?.after) errors.push(`${c.id}: ${loc} 覚醒後 text missing`);
      if (!f?.epithet) errors.push(`${c.id}: ${loc} 原罪 text missing`);
      if (!f?.quote) errors.push(`${c.id}: ${loc} 台詞 text missing`);
      // warden remark is required — there is no generic fallback template,
      // so a missing 典獄長 line would render blank on the record.
      if (!f?.warden) errors.push(`${c.id}: ${loc} 典獄長 remark missing`);
    }
  }
  return { errors, warnings };
}
