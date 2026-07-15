#!/usr/bin/env -S npx tsx
/**
 * compile-content — compiles the authored Manosaba workspace markdown into the
 * runtime `content/` package (design spec §5).
 *
 * COPING votemaps / tables come from the CERTIFIED reference JSON
 * (authoritative). The ORIGIN axis is the locked v2 block instrument, compiled
 * from `origin_v2/score_v2.py` (KEY) + `item_sheet.md` (EN texts) into
 * `blocks.origin.json` (the v1 `tree.origin.json` is retired and deleted).
 * Banks supply coping/pick display text. The manifest supplies the §3 redirect
 * map. Cards (gated by content/ship_list.json) supply per-locale prose; zh-TW
 * is synthesized from zh-CN via OpenCC(s2twp) + term_map_zhtw.json — for cards
 * AND for quiz strings (strings.zh-CN.json is emitted from the authored zh
 * sources when they exist; strings.zh-TW.json is derived).
 *
 * Everything is validated against the engine's zod schemas before writing, and
 * emitted with stable key ordering so content diffs are reviewable.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import * as OpenCC from "opencc-js";
import {
  cellKey,
  pickPairKey,
  parseCellKey,
  resolveTag,
  validateContent,
  fnv1a32String,
  type AuthoredTag,
  type ContentPackage,
  type HashSpec,
  type OriginBlocks,
  type QuestionsFile,
  type Question,
  type StringsFile,
  type PicksetsFile,
  type NeighborFile,
  type CardsManifest,
  type Meta,
} from "@manosaba/witch-exam-engine";
import { makeSources, DEFAULT_WORKSPACE, type Sources } from "./sources.js";
import { parseBanks, type BankData } from "./banks.js";
import {
  loadOriginV2,
  loadOriginStrings,
  loadCopingStrings,
  loadPickStrings,
  ESCAPE_OID,
  type QidStrings,
} from "./origin-blocks.js";
import { parseRedirectMap } from "./manifest.js";
import { parseCard, type ParsedCard } from "./cards.js";
import {
  parseCharacter,
  listCharacterIds,
  validateCharacters,
  CHARACTER_LOCALES,
  type ParsedCharacter,
} from "./characters.js";
import { subIndex, STYLE_NAME_TO_CODE, FAMILY_NAME_TO_CODE } from "./taxonomy.js";
import { buildCoverageMap, type ShippedCellInfo, type CoverageResult } from "./coverage.js";

// ------------------------------------------------------------------ utilities
function log(msg = ""): void {
  process.stdout.write(msg + "\n");
}
function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2) + "\n";
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort())
      o[k] = sortKeys((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}
function writeJson(path: string, obj: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stableStringify(obj), "utf8");
}
function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
function dropUnderscore<T extends Record<string, unknown>>(o: T): T {
  const out = { ...o };
  for (const k of Object.keys(out)) if (k.startsWith("_")) delete out[k];
  return out as T;
}
// ------------------------------------------------------------------ certified data
interface CopingTreeRaw extends Record<string, unknown> {
  routers: Record<string, Record<string, string>>;
  cores: Record<string, Record<string, string>>;
  tiebreaks: Record<string, Record<string, string>>;
  probes: Record<string, Record<string, string | boolean>>;
  style_stance: Record<string, string>;
}

function main(): void {
  const args = process.argv.slice(2);
  const workspace = argValue(args, "--workspace") ?? DEFAULT_WORKSPACE;
  const src = makeSources(workspace);
  const includePending = args.includes("--include-pending");

  log("compile-content — Manosaba witch-exam content package");
  log(`  workspace: ${workspace}`);
  log(`  output:    ${src.contentDir}`);
  log("");

  // 0. ship list (seed if absent)
  const shipList = loadJson<{ shipped: string[]; pendingReview?: string[]; characters?: boolean }>(src.shipList);
  const shippedIds = [...shipList.shipped, ...(includePending ? shipList.pendingReview ?? [] : [])];
  const shipCharacters = shipList.characters === true;

  // 1. certified coping tables + locked origin-v2 sources
  const copingRaw = dropUnderscore(loadJson<CopingTreeRaw>(join(src.scorer, "questions_k.json")));
  const scorerSlots = loadJson<{ slots: string[] }>(join(src.scorer, "slots.json")).slots;
  const originV2 = loadOriginV2({ originV2Dir: src.originV2 });
  const originBlocks: OriginBlocks = originV2.blocks;

  // slot list (v4-84): certified K.* slots + N01M..N14L (ask order) + V.* slots.
  // All v1 O.* slots (incl. O.C1) are retired with the origin tree.
  const nSlots = originBlocks.blocks.flatMap((b) => [`${b.id}M`, `${b.id}L`]);
  const slots = [
    ...scorerSlots.filter((s) => s.startsWith("K.")),
    ...nSlots,
    ...scorerSlots.filter((s) => s.startsWith("V.")),
  ];

  // 2. banks + redirect
  const banks = parseBanks(src);
  const redirectParse = parseRedirectMap(src.manifest);
  const warnings: string[] = [...banks.warnings, ...redirectParse.warnings, ...originV2.warnings];

  // 3. cards (shipped only)
  const cards: ParsedCard[] = [];
  for (const id of shippedIds) {
    try {
      const c = parseCard(id, src.cardsDir);
      cards.push(c);
      warnings.push(...c.warnings);
    } catch (e) {
      throw new Error(`failed to parse shipped card ${id}: ${(e as Error).message}`);
    }
  }

  // 4. derive tags + cells + coverage
  const tagId = (o: string, c: string): string => `${o}_${c}`;
  interface TagAgg {
    tag: string;
    cell: string;
    family: string;
    style: string;
    originSub: string;
    copingSub: string;
    variants: ParsedCard[]; // ordered by variant index
  }
  const tags = new Map<string, TagAgg>();
  const cellTags = new Map<string, Set<string>>();
  for (const c of cards) {
    const cell = cellKey(c.family, c.style);
    const t = tagId(c.originSub, c.copingSub);
    let agg = tags.get(t);
    if (!agg) {
      agg = { tag: t, cell, family: c.family, style: c.style, originSub: c.originSub, copingSub: c.copingSub, variants: [] };
      tags.set(t, agg);
    }
    agg.variants.push(c);
    (cellTags.get(cell) ?? cellTags.set(cell, new Set()).get(cell)!).add(t);
  }
  for (const agg of tags.values()) agg.variants.sort((a, b) => a.variant - b.variant);

  // 5. picksets + neighbor + manifest cells
  const picksets: PicksetsFile = { redirect: {}, cells: {} };
  const neighbor: NeighborFile = {};
  const manifestCells: CardsManifest["cells"] = {};
  const manifestTags: CardsManifest["tags"] = {};
  const variantCounts: Record<string, number> = {};

  const orderedTagList = [...tags.keys()].sort();
  const manifestIndexOf = new Map<string, number>();
  orderedTagList.forEach((t, i) => manifestIndexOf.set(t, i));

  // 5a. TOTAL cell-coverage map — recomputed from ship_list every compile.
  //     Every non-shipped grid cell routes to the nearest shipped cell so a
  //     session always reaches a card (design spec §5); §3 authorial routes are
  //     preserved when their target is shipped. Fails loud if coverage is not
  //     total (the coverage invariant).
  const shippedCells: ShippedCellInfo[] = [];
  for (const [cell, tset] of cellTags) {
    const agg0 = tags.get([...tset][0]!)!;
    const manifestOrder = Math.min(...[...tset].map((t) => manifestIndexOf.get(t)!));
    shippedCells.push({
      cell,
      family: agg0.family,
      style: agg0.style,
      tagCount: tset.size,
      manifestOrder,
    });
  }
  const coverage: CoverageResult = buildCoverageMap({
    families: Object.values(FAMILY_NAME_TO_CODE),
    styles: Object.keys(STYLE_NAME_TO_CODE),
    styleStance: copingRaw.style_stance,
    shipped: shippedCells,
    manifestRedirect: redirectParse.redirect,
  });
  picksets.redirect = coverage.redirect;

  for (const [cell, tset] of cellTags) {
    const { family, style } = parseCellKey(cell);
    const cellTagIds = [...tset].sort();
    const coveredOrigin = [...new Set(cellTagIds.map((t) => tags.get(t)!.originSub))].sort((a, b) => subIndex(a) - subIndex(b));
    const coveredCoping = [...new Set(cellTagIds.map((t) => tags.get(t)!.copingSub))].sort((a, b) => subIndex(a) - subIndex(b));

    // picksets
    const originAxis = coveredOrigin.length === 1 ? { auto: coveredOrigin[0]! } : { options: coveredOrigin };
    const copingAxis = coveredCoping.length === 1 ? { auto: coveredCoping[0]! } : { options: coveredCoping };
    picksets.cells[cell] = { origin: originAxis, coping: copingAxis };

    // neighbor: precompute (coveredO × coveredC) -> tag via the tier algorithm
    const authored: AuthoredTag[] = cellTagIds.map((t) => {
      const a = tags.get(t)!;
      return { tag: t, origin: a.originSub, coping: a.copingSub, manifestIndex: manifestIndexOf.get(t)! };
    });
    const table: Record<string, string> = {};
    const tiers: Record<string, number> = {};
    for (const o of coveredOrigin) {
      for (const c of coveredCoping) {
        const r = resolveTag(o, c, authored, subIndex, subIndex);
        if (!r) throw new Error(`coverage gap: no tag for ${o}x${c} in ${cell}`);
        table[pickPairKey(o, c)] = r.tag;
        tiers[pickPairKey(o, c)] = r.tier;
      }
    }
    neighbor[cell] = { table, tiers };

    manifestCells[cell] = { family, style, authoredTags: cellTagIds, coveredOrigin, coveredCoping };
  }

  for (const t of orderedTagList) {
    const a = tags.get(t)!;
    variantCounts[t] = a.variants.length;
    manifestTags[t] = {
      tag: t,
      cell: a.cell,
      originSub: a.originSub,
      copingSub: a.copingSub,
      variants: a.variants.length,
      locales: ["en", "ja", "zh-CN", "zh-TW"],
    };
  }

  // 6. hash spec (v4-84: v1 O.* slots + origin cert pins retired)
  const hashSpec: HashSpec = {
    bankVersion: "v4",
    manifestVersion: "v1",
    slots,
    sentinel: "X",
    fnv: { offset: 2166136261, prime: 16777619 },
    newInV3: ["K.P17", "K.P18", "K.P19", "K.P20", "K.P21"],
    variantCounts,
    permutation: {
      prng: "xorshift32",
      shuffle: "fisher-yates-descending",
      prePickPrefix: "K.* and N##[ML] slots only (slot order)",
      withinGroupSeed: "prePickString + '|V.OGROUP:<OID>'",
    },
  };

  // 7. questions.json (votemaps + display metadata)
  const questions = buildQuestions(slots, copingRaw, originBlocks);

  // 8. strings.en.json (+ authored locales: zh-CN, ja; zh-TW derived from zh-CN)
  const strings = buildStrings(banks, originV2.enStrings);
  const AUTHORED_LOCALES = ["zh-CN", "ja"];
  const localeStrings: Record<string, StringsFile | null> = {};
  for (const loc of AUTHORED_LOCALES) {
    localeStrings[loc] = buildLocaleStrings(
      loc,
      loadOriginStrings(src.originV2, loc, warnings),
      loadCopingStrings(src.originV2, loc, warnings),
      loadPickStrings(src.originV2, loc, warnings),
    );
  }
  const zhCN = localeStrings["zh-CN"] ?? null;

  // 9. cards manifest + card files
  const cardsManifest: CardsManifest = { tags: manifestTags, cells: manifestCells };

  // 10. assemble + validate the content package (engine schemas, fail loud)
  const pkg: ContentPackage = {
    questions,
    strings,
    copingTree: copingRaw as unknown as ContentPackage["copingTree"],
    originBlocks,
    hashSpec,
    picksets,
    neighbor,
    cardsManifest,
  };
  validateContent(pkg);

  const converter = OpenCC.Converter({ from: "cn", to: "twp" });
  const termMap = loadJson<{ overrides: Record<string, string> }>(src.termMap);
  const applyTW = (s: string): string => {
    let t = converter(s);
    for (const [from, to] of Object.entries(termMap.overrides)) t = t.split(from).join(to);
    return t;
  };

  // 11. write everything (deterministic)
  const C = src.contentDir;
  writeJson(join(C, "quiz", "questions.json"), questions);
  writeJson(join(C, "quiz", "tree.coping.json"), copingRaw);
  writeJson(join(C, "quiz", "blocks.origin.json"), originBlocks);
  // the v1 origin tree is retired: remove a stale artifact if present.
  rmSync(join(C, "quiz", "tree.origin.json"), { force: true });
  writeJson(join(C, "quiz", "picksets.json"), picksets);
  writeJson(join(C, "quiz", "neighbor.json"), neighbor);
  writeJson(join(C, "quiz", "hash.spec.json"), hashSpec);
  writeJson(join(C, "quiz", "strings.en.json"), strings);
  let localeFiles = 0;
  // authored locales (ja written directly; zh-CN written + zh-TW derived)
  for (const loc of AUTHORED_LOCALES) {
    const sf = localeStrings[loc];
    if (!sf) continue;
    writeJson(join(C, "quiz", `strings.${loc}.json`), sf);
    localeFiles += 1;
  }
  if (zhCN) {
    const zhTW: StringsFile = {
      locale: "zh-TW",
      questions: Object.fromEntries(
        Object.entries(zhCN.questions).map(([qid, q]) => [
          qid,
          {
            stem: applyTW(q.stem),
            options: Object.fromEntries(
              Object.entries(q.options).map(([oid, t]) => [oid, applyTW(t)]),
            ),
          },
        ]),
      ),
    };
    writeJson(join(C, "quiz", "strings.zh-TW.json"), zhTW);
    localeFiles += 1;
  }
  writeJson(join(C, "cards", "manifest.json"), cardsManifest);
  // Magic-name invariant (user directive 2026-07-08): every shipped card locale
  // must carry a magic NAME — the card headline. Owner-correctable via
  // tools/compiler/magic_names.json ({"<tag>.<locale>": "name"}). No fallback: fail loudly.
  const magicNames: Record<string, string> = JSON.parse(
    readFileSync(new URL("../magic_names.json", import.meta.url), "utf8"),
  ).names ?? {};
  const nameless: string[] = [];
  for (const t of orderedTagList) {
    const a = tags.get(t)!;
    for (const c of a.variants) {
      for (const loc of ["en", "ja", "zh-CN"]) {
        const f = c.locales[loc];
        if (!f) continue;
        const ov = magicNames[`${t}.${loc}`];
        if (ov) f.magic.name = ov;
        if (!f.magic.name) nameless.push(`${t} (${c.sourceId}) [${loc}]`);
      }
    }
  }
  if (nameless.length) {
    throw new Error(
      "COMPILE FAIL — shipped card(s) missing a magic NAME (the card headline; no fallback allowed):\n  " +
        nameless.join("\n  ") +
        "\nFix the source card or add an entry to tools/compiler/magic_names.json.",
    );
  }

  let cardFileCount = 0;
  for (const t of orderedTagList) {
    const a = tags.get(t)!;
    const files = emitCardLocaleFiles(a, converter, termMap.overrides);
    for (const [path, obj] of files) {
      writeJson(join(C, "cards", path), obj);
      cardFileCount++;
    }
  }

  // 11b. characters — the 13 special character records (design spec §3.7).
  // Gated all-or-nothing by ship_list.json's `"characters"` flag. Emitted as
  // one file per locale (content/characters/<locale>.json); zh-TW derived from
  // zh-CN like cards. Deliberately EXCLUDED from the contentVersion hash below:
  // character edits must never invalidate visitors' saved exam progress.
  let characters: ParsedCharacter[] = [];
  let characterLocaleFiles = 0;
  if (shipCharacters) {
    characters = listCharacterIds(src.charactersDir).map((id) => {
      try {
        return parseCharacter(id, src.charactersDir);
      } catch (e) {
        throw new Error(`failed to parse character ${id}: ${(e as Error).message}`);
      }
    });
    const check = validateCharacters(characters, new Set(orderedTagList));
    warnings.push(...check.warnings);
    if (check.errors.length) {
      throw new Error("COMPILE FAIL — character sources invalid:\n  " + check.errors.join("\n  "));
    }
    const sorted = [...characters].sort((a, b) => a.id.localeCompare(b.id));
    for (const locale of [...CHARACTER_LOCALES, "zh-TW"]) {
      const records = sorted.map((c) => {
        const from = locale === "zh-TW" ? "zh-CN" : locale;
        const tw = locale === "zh-TW";
        const loc = (s: string): string => (tw ? applyTW(s) : s);
        const f = c.locales[from]!;
        return {
          id: c.id,
          tag: c.tag,
          color: c.color,
          locale,
          name: loc(c.name[from]!),
          magicName: loc(c.magicName[from]!),
          awakening: { before: loc(f.before), after: loc(f.after) },
          epithet: loc(f.epithet),
          quote: loc(f.quote),
          // optional per-character warden remark; absent → runtime falls back
          // to the generic i18n template
          ...(f.warden ? { warden: loc(f.warden) } : {}),
        };
      });
      writeJson(join(C, "characters", `${locale}.json`), records);
      characterLocaleFiles++;
    }
  } else {
    // feature off: remove the compiled artifact so the site auto-disables.
    rmSync(join(C, "characters"), { recursive: true, force: true });
  }

  // 12. meta.json (content hash = FNV over the machine-critical artifacts)
  const contentHash = fnv1a32String(
    [questions, copingRaw, originBlocks, picksets, neighbor, hashSpec].map(stableStringify).join(""),
  );
  const meta: Meta = {
    contentVersion: `0x${(contentHash >>> 0).toString(16).padStart(8, "0")}`,
    quizVersion: "v4-84",
    bankVersion: "v4",
    manifestVersion: "v1",
    generatedAt: new Date().toISOString(),
    counts: {
      slots: slots.length,
      originBlocks: originBlocks.blocks.length,
      shippedCards: cards.length,
      shippedTags: tags.size,
      authoredCells: cellTags.size,
      redirects: Object.keys(coverage.redirect).length,
      manifestRedirects: coverage.counts.manifest,
      fallbackRedirects: coverage.counts.fallback,
      cardLocaleFiles: cardFileCount,
      quizStringLocaleFiles: 1 + localeFiles,
      families: 8,
      styles: 25,
      characters: characters.length,
      characterLocaleFiles,
    },
    locales: ["en", "ja", "zh-CN", "zh-TW"],
  };
  writeJson(join(C, "meta.json"), meta);

  report(src, cards, tags, cellTags, coverage, warnings, meta);
}

// ------------------------------------------------------------------ builders
function buildQuestions(slots: string[], coping: CopingTreeRaw, origin: OriginBlocks): QuestionsFile {
  const out: QuestionsFile = {};
  const routers = new Set(Object.keys(coping.routers));
  const cores = new Set(Object.keys(coping.cores));
  const tiebreaks = new Set(Object.keys(coping.tiebreaks));
  const probes = new Set(Object.keys(coping.probes));
  const blockById = new Map(origin.blocks.map((b) => [b.id, b]));

  for (const qid of slots) {
    if (qid.startsWith("K.")) {
      if (routers.has(qid)) out[qid] = kOpt(qid, "router", coping.routers[qid]!, "stance", qid === "K.R4");
      else if (cores.has(qid)) out[qid] = kOpt(qid, "core", coping.cores[qid]!, "style", false);
      else if (tiebreaks.has(qid)) out[qid] = kOpt(qid, "tiebreak", coping.tiebreaks[qid]!, "style", true);
      else if (probes.has(qid)) out[qid] = kOpt(qid, "probe", probeOpts(coping.probes[qid]!), "style", false);
    } else if (/^N\d{2}[ML]$/.test(qid)) {
      // origin-v2 block slot: M = most-mine (+1, escape allowed), L = least-mine (-1)
      const b = blockById.get(qid.slice(0, 3));
      if (!b) throw new Error(`slot ${qid} has no origin block`);
      const most = qid.endsWith("M");
      const letters = Object.keys(b.key).sort();
      const options = letters.map((oid) => ({
        oid,
        votes: { [b.key[oid]!]: most ? 1 : -1 },
      }));
      const entry: Question = {
        qid,
        part: "O",
        kind: most ? "most" : "least",
        stemKey: qid,
        options,
        register: b.register,
      };
      if (most) {
        options.push({ oid: ESCAPE_OID, votes: {} });
        entry.escapeOid = ESCAPE_OID;
      } else {
        // the L screen is display-filtered against the block's M pick
        entry.displayFilter = true;
      }
      out[qid] = entry;
    } else {
      // V.* — options are cell-dependent, assembled at runtime
      const kind = qid === "V.OGROUP" ? "group" : "pick";
      out[qid] = { qid, part: "V", kind, stemKey: qid, options: [] };
    }
  }
  return out;
}
function kOpt(qid: string, kind: Question["kind"], map: Record<string, string>, label: "stance" | "style", displayFilter: boolean): Question {
  void label;
  const options = Object.entries(map).map(([oid]) => ({ oid, votes: { [map[oid]!]: 1 } }));
  const q: Question = { qid, part: "K", kind, stemKey: qid, options };
  if (displayFilter) q.displayFilter = true;
  return q;
}
function probeOpts(entry: Record<string, string | boolean>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entry)) if (k !== "category" && k !== "new_slot") out[k] = v as string;
  return out;
}

function buildStrings(banks: BankData, originEn: Record<string, QidStrings>): StringsFile {
  const questions: StringsFile["questions"] = {};
  for (const qid of Object.keys(banks.stems)) {
    questions[qid] = { stem: banks.stems[qid] ?? "", options: banks.optionText[qid] ?? {} };
  }
  // ensure option maps present even when stem missing
  for (const qid of Object.keys(banks.optionText)) {
    questions[qid] ??= { stem: banks.stems[qid] ?? "", options: banks.optionText[qid]! };
  }
  // origin-v2 N-block strings (parsed from item_sheet.md)
  for (const [qid, q] of Object.entries(originEn)) {
    questions[qid] = { stem: q.stem, options: { ...q.options } };
  }
  questions["V.OGROUP"] = { stem: banks.pickStems.group, options: { ...banks.groupLine } };
  questions["V.OPICK"] = { stem: banks.pickStems.origin, options: { ...banks.originPickText } };
  questions["V.CPICK"] = { stem: banks.pickStems.coping, options: { ...banks.copingPickText } };
  return { locale: "en", questions };
}

/**
 * strings.<locale>.json — structure-only merge of the authored sources for one
 * locale (origin N-blocks + coping K.* + pick-tail V.*). Emits null when no
 * source exists yet; qids missing from the sources are simply absent (the
 * session falls back per-qid to en).
 */
function buildLocaleStrings(
  locale: string,
  origin: Record<string, QidStrings> | null,
  coping: Record<string, QidStrings> | null,
  picks: Record<string, QidStrings> | null,
): StringsFile | null {
  if (!origin && !coping && !picks) return null;
  const questions: StringsFile["questions"] = {};
  for (const src of [coping, origin, picks]) {
    if (!src) continue;
    for (const [qid, q] of Object.entries(src)) {
      questions[qid] = { stem: q.stem, options: { ...q.options } };
    }
  }
  return { locale, questions };
}

type Converter = (s: string) => string;
function emitCardLocaleFiles(
  agg: { tag: string; cell: string; family: string; style: string; originSub: string; copingSub: string; variants: ParsedCard[] },
  toTW: Converter,
  overrides: Record<string, string>,
): [string, unknown][] {
  const out: [string, unknown][] = [];
  const locales = ["en", "ja", "zh-CN"];
  const applyTW = (s: string): string => {
    let t = toTW(s);
    for (const [from, to] of Object.entries(overrides)) t = t.split(from).join(to);
    return t;
  };
  const twOf = (f: { epithet: string; magic: { name: string; text: string }; crime: string[]; execution: string[]; epitaph: string }) => ({
    epithet: applyTW(f.epithet),
    magic: { name: applyTW(f.magic.name), text: applyTW(f.magic.text) },
    crime: f.crime.map(applyTW),
    execution: f.execution.map(applyTW),
    epitaph: applyTW(f.epitaph),
  });
  for (const locale of [...locales, "zh-TW"]) {
    const variants = agg.variants.map((c) => {
      if (locale === "zh-TW") {
        const zh = c.locales["zh-CN"];
        return { variant: c.variant, fields: zh ? twOf(zh) : emptyFields() };
      }
      return { variant: c.variant, fields: c.locales[locale] ?? emptyFields() };
    });
    out.push([
      `${agg.tag}.${locale}.json`,
      { tag: agg.tag, cell: agg.cell, family: agg.family, style: agg.style, originSub: agg.originSub, copingSub: agg.copingSub, locale, variants },
    ]);
  }
  return out;
}
function emptyFields() {
  return { epithet: "", magic: { name: "", text: "" }, crime: [] as string[], execution: [] as string[], epitaph: "" };
}

// ------------------------------------------------------------------ report
function report(
  src: Sources,
  cards: ParsedCard[],
  tags: Map<string, unknown>,
  cellTags: Map<string, Set<string>>,
  coverage: CoverageResult,
  warnings: string[],
  meta: Meta,
): void {
  const gridSize = 8 * 25;
  const { direct, manifest, fallback, tier } = coverage.counts;
  log("");
  log("=== COMPILE REPORT ===");
  log(`  contentVersion: ${meta.contentVersion}   quizVersion: ${meta.quizVersion}`);
  log(`  shipped cards:  ${cards.length}   shipped tags: ${tags.size}   authored cells: ${cellTags.size}`);
  log(`  redirect rows:  ${Object.keys(coverage.redirect).length}`);
  log(`  card locale files: ${meta.counts.cardLocaleFiles}`);
  log(
    `  characters:     ${
      meta.counts.characters
        ? `${meta.counts.characters} (${meta.counts.characterLocaleFiles} locale files)`
        : "off (ship_list.characters !== true)"
    }`,
  );
  log("");
  log(`  TOTAL cell coverage of the ${gridSize}-cell grid (invariant: 0 uncovered):`);
  log(`    direct (shipped-covered):   ${direct}`);
  log(`    manifest-redirect (§3):     ${manifest}`);
  log(`    fallback-redirect (tiers):  ${fallback}`);
  log(`    ---------------------------------`);
  log(`    total:                      ${direct + manifest + fallback}`);
  log("");
  log(`  fallback-redirect tier distribution:`);
  log(`    tier 1 (same family + stance):   ${tier[1] ?? 0}`);
  log(`    tier 2 (same family):            ${tier[2] ?? 0}`);
  log(`    tier 3 (same stance, near fam):  ${tier[3] ?? 0}`);
  log(`    tier 4 (global default/density): ${tier[4] ?? 0}`);
  log("");
  log("  authored cells:");
  for (const [cell, tset] of [...cellTags].sort()) {
    log(`    ${cell.replace("|", " x ")} -> ${[...tset].sort().join(", ")}`);
  }
  const uniqW = [...new Set(warnings)];
  log("");
  log(`  warnings: ${uniqW.length}`);
  for (const w of uniqW.slice(0, 25)) log(`    - ${w}`);
  if (uniqW.length > 25) log(`    ... and ${uniqW.length - 25} more`);
  log("");
  log(`  wrote content package under ${src.contentDir}`);
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

main();
