#!/usr/bin/env -S npx tsx
/**
 * compile-content — compiles the authored Manosaba workspace markdown into the
 * runtime `content/` package (design spec §5).
 *
 * Votemaps / tree tables / hash spec come from the CERTIFIED reference JSON
 * (authoritative). Banks supply display text. The manifest supplies the §3
 * redirect map. Cards (gated by content/ship_list.json) supply per-locale prose;
 * zh-TW is synthesized from zh-CN via OpenCC(s2twp) + term_map_zhtw.json.
 *
 * Everything is validated against the engine's zod schemas before writing, and
 * emitted with stable key ordering so content diffs are reviewable.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
import { parseRedirectMap } from "./manifest.js";
import { parseCard, type ParsedCard } from "./cards.js";
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

const SHIP_SEED = {
  _doc: "Allowlist controlling which cards compile into content/. Only `shipped` compiles. Move a tag from pendingReview to shipped after owner review, then recompile. Ids are output/cards/*.md basenames.",
  shipped: [
    "card_01_ed1_spotlight",
    "card_02_ed2_jester",
    "card_03_ed5_prodigy",
    "card_04_awkward_mb_depender",
    "card_05_ed9_spotlight",
    "card_06_abn1_sentinel",
    "card_07_vc1_lookout",
  ],
  pendingReview: [
    "DEF-SP-001",
    "ALN-AV-001",
    "ED-SS-001",
    "FAI-AV-001",
    "ALN-FA-001",
    "ABN-CL-001",
    "MB-WT-001",
  ],
};

// ------------------------------------------------------------------ certified data
interface CopingTreeRaw extends Record<string, unknown> {
  routers: Record<string, Record<string, string>>;
  cores: Record<string, Record<string, string>>;
  tiebreaks: Record<string, Record<string, string>>;
  probes: Record<string, Record<string, string | boolean>>;
  style_stance: Record<string, string>;
}
interface OriginTreeRaw extends Record<string, unknown> {
  questions: Record<string, { kind: string; options: Record<string, Record<string, number>>; escape?: string | null; new_slot?: boolean }>;
  pairs: { pair: [string, string]; primary: string; alternate: string | null }[];
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
  if (!existsSync(src.shipList)) {
    writeJson(src.shipList, SHIP_SEED);
    log(`  seeded ${src.shipList}`);
  }
  const shipList = loadJson<{ shipped: string[]; pendingReview?: string[] }>(src.shipList);
  const shippedIds = [...shipList.shipped, ...(includePending ? shipList.pendingReview ?? [] : [])];

  // 1. certified tables
  const copingRaw = dropUnderscore(loadJson<CopingTreeRaw>(join(src.scorer, "questions_k.json")));
  const originRaw = dropUnderscore(loadJson<OriginTreeRaw>(join(src.scorer, "questions_o.json")));
  const priorRows = loadJson<{ rows: Record<string, unknown> }>(join(src.scorer, "prior.json")).rows;
  const slots = loadJson<{ slots: string[] }>(join(src.scorer, "slots.json")).slots;
  const originTree = { ...originRaw, prior: priorRows };

  // 2. banks + redirect
  const banks = parseBanks(src);
  const redirectParse = parseRedirectMap(src.manifest);
  const warnings: string[] = [...banks.warnings, ...redirectParse.warnings];

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

  // 6. hash spec
  const hashSpec: HashSpec = {
    bankVersion: "v3",
    manifestVersion: "v1",
    slots,
    sentinel: "X",
    fnv: { offset: 2166136261, prime: 16777619 },
    newInV3: ["K.P17", "K.P18", "K.P19", "K.P20", "K.P21", "O.R3", "O.P4b"],
    variantCounts,
    permutation: {
      prng: "xorshift32",
      shuffle: "fisher-yates-descending",
      prePickPrefix: "K.* and O.* slots only (Appendix A order)",
      withinGroupSeed: "prePickString + '|V.OGROUP:<OID>'",
    },
  };

  // 7. questions.json (votemaps + display metadata)
  const questions = buildQuestions(slots, copingRaw, originRaw);

  // 8. strings.en.json
  const strings = buildStrings(banks);

  // 9. cards manifest + card files
  const cardsManifest: CardsManifest = { tags: manifestTags, cells: manifestCells };

  // 10. assemble + validate the content package (engine schemas, fail loud)
  const pkg: ContentPackage = {
    questions,
    strings,
    copingTree: copingRaw as unknown as ContentPackage["copingTree"],
    originTree: originTree as unknown as ContentPackage["originTree"],
    hashSpec,
    picksets,
    neighbor,
    cardsManifest,
  };
  validateContent(pkg);

  // 11. write everything (deterministic)
  const C = src.contentDir;
  writeJson(join(C, "quiz", "questions.json"), questions);
  writeJson(join(C, "quiz", "tree.coping.json"), copingRaw);
  writeJson(join(C, "quiz", "tree.origin.json"), originTree);
  writeJson(join(C, "quiz", "picksets.json"), picksets);
  writeJson(join(C, "quiz", "neighbor.json"), neighbor);
  writeJson(join(C, "quiz", "hash.spec.json"), hashSpec);
  writeJson(join(C, "quiz", "strings.en.json"), strings);
  writeJson(join(C, "cards", "manifest.json"), cardsManifest);

  const converter = OpenCC.Converter({ from: "cn", to: "twp" });
  const termMap = loadJson<{ overrides: Record<string, string> }>(src.termMap);
  let cardFileCount = 0;
  for (const t of orderedTagList) {
    const a = tags.get(t)!;
    const files = emitCardLocaleFiles(a, converter, termMap.overrides);
    for (const [path, obj] of files) {
      writeJson(join(C, "cards", path), obj);
      cardFileCount++;
    }
  }

  // 12. meta.json (content hash = FNV over the machine-critical artifacts)
  const contentHash = fnv1a32String(
    [questions, copingRaw, originTree, picksets, neighbor, hashSpec].map(stableStringify).join(""),
  );
  const meta: Meta = {
    contentVersion: `0x${(contentHash >>> 0).toString(16).padStart(8, "0")}`,
    quizVersion: "v3-89",
    bankVersion: "v3",
    manifestVersion: "v1",
    generatedAt: new Date().toISOString(),
    counts: {
      slots: slots.length,
      shippedCards: cards.length,
      shippedTags: tags.size,
      authoredCells: cellTags.size,
      redirects: Object.keys(coverage.redirect).length,
      manifestRedirects: coverage.counts.manifest,
      fallbackRedirects: coverage.counts.fallback,
      cardLocaleFiles: cardFileCount,
      families: 8,
      styles: 25,
    },
    locales: ["en", "ja", "zh-CN", "zh-TW"],
  };
  writeJson(join(C, "meta.json"), meta);

  report(src, cards, tags, cellTags, coverage, warnings, meta);
}

// ------------------------------------------------------------------ builders
function buildQuestions(slots: string[], coping: CopingTreeRaw, origin: OriginTreeRaw): QuestionsFile {
  const out: QuestionsFile = {};
  const routers = new Set(Object.keys(coping.routers));
  const cores = new Set(Object.keys(coping.cores));
  const tiebreaks = new Set(Object.keys(coping.tiebreaks));
  const probes = new Set(Object.keys(coping.probes));
  const altOf = new Map<string, string>();
  for (const p of origin.pairs) if (p.alternate) altOf.set(p.alternate, p.primary);

  for (const qid of slots) {
    if (qid.startsWith("K.")) {
      if (routers.has(qid)) out[qid] = kOpt(qid, "router", coping.routers[qid]!, "stance", qid === "K.R4");
      else if (cores.has(qid)) out[qid] = kOpt(qid, "core", coping.cores[qid]!, "style", false);
      else if (tiebreaks.has(qid)) out[qid] = kOpt(qid, "tiebreak", coping.tiebreaks[qid]!, "style", true);
      else if (probes.has(qid)) out[qid] = kOpt(qid, "probe", probeOpts(coping.probes[qid]!), "style", false);
    } else if (qid.startsWith("O.")) {
      const q = origin.questions[qid];
      if (qid === "O.C1") {
        out[qid] = { qid, part: "O", kind: "confirmation", stemKey: qid, options: [] };
      } else if (q) {
        const kind = q.kind === "alternate" ? "alternate" : q.kind === "separation" ? "separation" : q.kind === "router" ? "router" : "discriminator";
        const options = Object.entries(q.options).map(([oid, votes]) => ({ oid, votes }));
        const entry: Question = { qid, part: "O", kind: kind as Question["kind"], stemKey: qid, options };
        if (q.escape !== undefined && q.escape !== null) entry.escapeOid = q.escape;
        const primary = altOf.get(qid);
        if (primary) entry.alternateOf = primary;
        out[qid] = entry;
      }
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

function buildStrings(banks: BankData): StringsFile {
  const questions: StringsFile["questions"] = {};
  for (const qid of Object.keys(banks.stems)) {
    questions[qid] = { stem: banks.stems[qid] ?? "", options: banks.optionText[qid] ?? {} };
  }
  // ensure option maps present even when stem missing
  for (const qid of Object.keys(banks.optionText)) {
    questions[qid] ??= { stem: banks.stems[qid] ?? "", options: banks.optionText[qid]! };
  }
  questions["O.C1"] = { stem: banks.stems["O.C1"] ?? "", options: { ...banks.wantedLines } };
  questions["V.OGROUP"] = { stem: banks.pickStems.group, options: { ...banks.groupLine } };
  questions["V.OPICK"] = { stem: banks.pickStems.origin, options: { ...banks.originPickText } };
  questions["V.CPICK"] = { stem: banks.pickStems.coping, options: { ...banks.copingPickText } };
  return { locale: "en", questions };
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
  const twOf = (f: { epithet: string; magic: string; crime: string[]; execution: string[]; epitaph: string }) => ({
    epithet: applyTW(f.epithet),
    magic: applyTW(f.magic),
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
  return { epithet: "", magic: "", crime: [] as string[], execution: [] as string[], epitaph: "" };
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
