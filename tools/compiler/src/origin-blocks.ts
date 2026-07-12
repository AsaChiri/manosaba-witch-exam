/**
 * Origin v2 sources (LOCKED 2026-07-10 — origin_v2/LOCKED.md).
 *
 * The workspace source of truth is parsed, never re-authored here:
 *  - `score_v2.py`      — the locked KEY dict (block -> letter -> family) and
 *                         the canonical tie-break ORDER. Authoritative for keys.
 *  - `item_sheet.md`    — the locked r1 EN texts: 7 register sections × 2
 *                         blocks × 4 keyed lines + the shared escape line.
 *  - `quiz_strings_origin.zh-CN.json` (optional) — authored zh-CN stems/options
 *                         per block ({locale, escapeM, blocks:{N01:{stemM,
 *                         stemL, options{A..D}}}}).
 *  - `quiz_strings_coping.zh-CN.json` (optional) — authored zh-CN coping texts
 *                         ({locale, questions:{qid:{stem, options:{oid:text}}}}).
 *
 * Everything parsed is cross-validated against the locked expectations (14
 * blocks, registers N01/N02=scenes … N13/N14=stings, letters exactly A-D,
 * families ⊆ ORDER); any drift fails the compile loudly.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { OriginBlocks } from "@manosaba/witch-exam-engine";

export const ESCAPE_OID = "E";

/** locked block -> register mapping (stem keys / grouping). */
const LOCKED_REGISTERS: Record<string, string> = {
  N01: "scenes", N02: "scenes",
  N03: "sentences", N04: "sentences",
  N05: "hums", N06: "hums",
  N07: "rules", N08: "rules",
  N09: "weather", N10: "weather",
  N11: "needed", N12: "needed",
  N13: "stings", N14: "stings",
};

export interface QidStrings {
  stem: string;
  options: Record<string, string>;
}

export interface OriginV2Data {
  /** the engine-shaped blocks artifact (blocks.origin.json). */
  blocks: OriginBlocks;
  /** EN display strings per slot qid (N01M/N01L/...). */
  enStrings: Record<string, QidStrings>;
  warnings: string[];
}

// ------------------------------------------------------------------ score_v2.py
/** Parse the locked KEY dict + canonical ORDER out of score_v2.py. */
export function parseScoreV2(path: string): {
  order: string[];
  key: Record<string, Record<string, string>>;
} {
  const text = readFileSync(path, "utf8");

  const orderM = /ORDER\s*=\s*\[([^\]]*)\]/.exec(text);
  if (!orderM) throw new Error(`origin-v2: ORDER list not found in ${path}`);
  const order = [...orderM[1]!.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]!);

  const key: Record<string, Record<string, string>> = {};
  const rowRe = /"(N\d{2})":\s*\{([^}]*)\}/g;
  for (const m of text.matchAll(rowRe)) {
    const block = m[1]!;
    const cells: Record<string, string> = {};
    for (const c of m[2]!.matchAll(/"([A-D])":\s*"([A-Z]+)"/g)) {
      cells[c[1]!] = c[2]!;
    }
    key[block] = cells;
  }
  if (Object.keys(key).length !== 14) {
    throw new Error(
      `origin-v2: expected 14 KEY rows in ${path}, got ${Object.keys(key).length}`,
    );
  }
  for (const [block, cells] of Object.entries(key)) {
    const letters = Object.keys(cells).sort().join(",");
    if (letters !== "A,B,C,D") {
      throw new Error(`origin-v2: KEY ${block} letters ${letters} != A,B,C,D`);
    }
    for (const fam of Object.values(cells)) {
      if (!order.includes(fam)) {
        throw new Error(`origin-v2: KEY ${block} family ${fam} not in ORDER`);
      }
    }
  }
  return { order, key };
}

// ------------------------------------------------------------------ item_sheet.md
interface SheetBlock {
  id: string;
  register: string;
  firstInRegister: boolean;
  intro: string;
  options: Record<string, string>; // A-D
  escapeText: string;
}

/** Parse the locked EN item sheet: register sections + block option lines. */
export function parseItemSheet(path: string): SheetBlock[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const blocks: SheetBlock[] = [];
  let register: string | null = null;
  let intro = "";
  let collectingIntro = false;
  let cur: SheetBlock | null = null;
  let firstInRegister = true;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      const words = h[1]!.trim().split(/\s+/);
      register = words[words.length - 1]!.toLowerCase();
      intro = "";
      collectingIntro = false;
      firstInRegister = true;
      cur = null;
      continue;
    }
    if (register === null) continue;

    // block marker must be checked BEFORE the italic-intro branch: "**N01**"
    // starts with "*", so the intro collector would otherwise swallow it.
    const bm = /^\*\*(N\d{2})\*\*$/.exec(line.trim());
    if (bm) {
      collectingIntro = false;
      cur = {
        id: bm[1]!,
        register,
        firstInRegister,
        intro: intro.replace(/\s+/g, " ").trim(),
        options: {},
        escapeText: "",
      };
      blocks.push(cur);
      firstInRegister = false;
      continue;
    }

    // italic intro (may wrap over multiple lines)
    if (!cur && (collectingIntro || line.startsWith("*"))) {
      collectingIntro = true;
      intro = (intro ? intro + " " : "") + line.replace(/^\*|\*$/g, "").trim();
      if (line.endsWith("*")) collectingIntro = false;
      continue;
    }
    if (!cur) continue;
    const om = /^-\s*([A-E])\.\s+(.*)$/.exec(line.trim());
    if (om) {
      const oid = om[1]!;
      const text = om[2]!.trim();
      if (oid === ESCAPE_OID) cur.escapeText = text;
      else cur.options[oid] = text;
    }
  }
  return blocks;
}

// ------------------------------------------------------------------ EN strings
/**
 * EN stems are assembled deterministically from the item sheet: the first
 * block of a register carries the register intro (its trailing dual
 * most/least question stripped); the second block gets a short continuation,
 * mirroring the zh-CN structure. The M/L question tails restate the sheet's
 * own definitions ("most from the inside" / "least yours, simply not your
 * story").
 */
const DUAL_QUESTION = /\s*Which do you know most from the inside, which least\?$/;
const M_TAIL = "Which do you know most from the inside?";
const L_TAIL = "And which is least yours — simply not your story?";

function enStemM(b: SheetBlock): string {
  if (!b.firstInRegister) return `Four more. ${M_TAIL}`;
  const intro = b.intro.replace(DUAL_QUESTION, "").trim();
  return intro ? `${intro} ${M_TAIL}` : M_TAIL;
}

// ------------------------------------------------------------------ assembly
export interface OriginSourcePaths {
  /** origin_v2 validation dir in the workspace. */
  originV2Dir: string;
}

export function loadOriginV2(paths: OriginSourcePaths): OriginV2Data {
  const warnings: string[] = [];
  const scorePy = join(paths.originV2Dir, "score_v2.py");
  const itemSheet = join(paths.originV2Dir, "item_sheet.md");

  const { order, key } = parseScoreV2(scorePy);
  const sheet = parseItemSheet(itemSheet);

  // cross-validate the sheet against the locked KEY + register table
  if (sheet.length !== 14) {
    throw new Error(`origin-v2: item sheet has ${sheet.length} blocks, want 14`);
  }
  const byId = new Map(sheet.map((b) => [b.id, b]));
  for (const id of Object.keys(LOCKED_REGISTERS)) {
    const b = byId.get(id);
    if (!b) throw new Error(`origin-v2: item sheet missing block ${id}`);
    if (b.register !== LOCKED_REGISTERS[id]) {
      throw new Error(
        `origin-v2: block ${id} register ${b.register} != locked ${LOCKED_REGISTERS[id]}`,
      );
    }
    const letters = Object.keys(b.options).sort().join(",");
    if (letters !== "A,B,C,D") {
      throw new Error(`origin-v2: item sheet ${id} letters ${letters} != A,B,C,D`);
    }
    if (!b.escapeText) warnings.push(`origin-v2: ${id} missing E line in item sheet`);
  }

  // blocks artifact, in ask order N01..N14
  const ids = Object.keys(key).sort();
  const blocks: OriginBlocks = {
    version: "origin-v2",
    escape: ESCAPE_OID,
    families: order,
    blocks: ids.map((id) => ({
      id,
      register: LOCKED_REGISTERS[id]!,
      key: { A: key[id]!["A"]!, B: key[id]!["B"]!, C: key[id]!["C"]!, D: key[id]!["D"]! },
    })),
  };

  // EN strings per slot qid
  const enStrings: Record<string, QidStrings> = {};
  for (const id of ids) {
    const b = byId.get(id)!;
    enStrings[`${id}M`] = {
      stem: enStemM(b),
      options: { ...b.options, [ESCAPE_OID]: b.escapeText },
    };
    enStrings[`${id}L`] = { stem: L_TAIL, options: { ...b.options } };
  }

  return { blocks, enStrings, warnings };
}

/**
 * Optional authored origin N-block strings for one locale
 * (`quiz_strings_origin.<locale>.json`, shape {locale, escapeM, blocks:{N01:
 * {stemM, stemL, options{A..D}}}}). Maps each block to its N##M / N##L qids.
 * Returns null when the source does not exist yet.
 */
export function loadOriginStrings(
  originV2Dir: string,
  locale: string,
  warnings: string[],
): Record<string, QidStrings> | null {
  const p = join(originV2Dir, `quiz_strings_origin.${locale}.json`);
  if (!existsSync(p)) {
    warnings.push(`origin-v2: no ${locale} origin strings source; N blocks not emitted for ${locale}`);
    return null;
  }
  const raw = JSON.parse(readFileSync(p, "utf8")) as {
    escapeM?: string;
    blocks?: Record<
      string,
      { stemM?: string; stemL?: string; options?: Record<string, string> }
    >;
  };
  const escapeM = raw.escapeM ?? "";
  if (!escapeM) warnings.push(`origin-v2: ${locale} origin source missing escapeM`);
  const out: Record<string, QidStrings> = {};
  for (const [id, b] of Object.entries(raw.blocks ?? {})) {
    if (!/^N\d{2}$/.test(id) || !b.options) continue;
    const letters = Object.keys(b.options).sort().join(",");
    if (letters !== "A,B,C,D") {
      throw new Error(`origin-v2: ${locale} ${id} option letters ${letters} != A,B,C,D`);
    }
    out[`${id}M`] = {
      stem: b.stemM ?? "",
      options: { ...b.options, [ESCAPE_OID]: escapeM },
    };
    out[`${id}L`] = { stem: b.stemL ?? "", options: { ...b.options } };
  }
  return Object.keys(out).length ? out : null;
}

/** Optional authored coping strings for one locale ({locale, questions:{qid:{stem,options}}}). */
export function loadCopingStrings(
  originV2Dir: string,
  locale: string,
  warnings: string[],
): Record<string, QidStrings> | null {
  const p = join(originV2Dir, `quiz_strings_coping.${locale}.json`);
  if (!existsSync(p)) {
    warnings.push(`origin-v2: no ${locale} coping strings source; K.* not emitted for ${locale}`);
    return null;
  }
  const raw = JSON.parse(readFileSync(p, "utf8")) as {
    questions?: Record<string, { stem?: string; options?: Record<string, string> }>;
  };
  const out: Record<string, QidStrings> = {};
  for (const [qid, q] of Object.entries(raw.questions ?? {})) {
    out[qid] = { stem: q.stem ?? "", options: { ...(q.options ?? {}) } };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Optional authored pick-tail strings for one locale — merges the two authored
 * files `quiz_strings_picks_origin.<locale>.json` (V.OGROUP, V.OPICK) and
 * `quiz_strings_picks_coping.<locale>.json` (V.CPICK). Returns null if neither
 * exists yet.
 */
export function loadPickStrings(
  originV2Dir: string,
  locale: string,
  warnings: string[],
): Record<string, QidStrings> | null {
  const out: Record<string, QidStrings> = {};
  for (const kind of ["origin", "coping"]) {
    const p = join(originV2Dir, `quiz_strings_picks_${kind}.${locale}.json`);
    if (!existsSync(p)) {
      warnings.push(`origin-v2: no ${locale} ${kind} pick strings source; V.* ${kind} not emitted for ${locale}`);
      continue;
    }
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      questions?: Record<string, { stem?: string; options?: Record<string, string> }>;
    };
    for (const [qid, q] of Object.entries(raw.questions ?? {})) {
      out[qid] = { stem: q.stem ?? "", options: { ...(q.options ?? {}) } };
    }
  }
  return Object.keys(out).length ? out : null;
}
