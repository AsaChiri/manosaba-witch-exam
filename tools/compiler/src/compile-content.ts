#!/usr/bin/env -S npx tsx
/**
 * compile-content — compiles authored card and character markdown into the
 * runtime `content/` package.
 *
 * The quiz design is locked: no new questions or choices are introduced. The
 * compiler still compiles its structural/scoring artifacts and the
 * card-dependent routing indexes, so a growing card corpus becomes reachable
 * through the same fixed quiz rules.
 *
 * Question and choice PROSE is the sole exception. All committed
 * `content/quiz/strings.*.json` files are authoritative and are never generated,
 * translated, or rewritten here.
 *
 * Cards (gated by `content/ship_list.json`) supply all four authored locale
 * versions. The compiler performs no translation or script conversion.
 *
 * Emitted files use stable key ordering so content diffs are reviewable.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  cellKey,
  parseCellKey,
  pickPairKey,
  resolveTag,
  validateContent,
  fnv1a32String,
  CardsManifestSchema,
  HashSpecSchema,
  PicksetsFileSchema,
  NeighborFileSchema,
  type AuthoredTag,
  type CardsManifest,
  type ContentPackage,
  type HashSpec,
  type NeighborFile,
  type OriginBlocks,
  type PicksetsFile,
  type Question,
  type QuestionsFile,
  type Meta,
} from "@manosaba/witch-exam-engine";
import { makeSources, DEFAULT_WORKSPACE, type Sources } from "./sources.js";
import { parseCard, CARD_LOCALES, type ParsedCard } from "./cards.js";
import {
  parseCharacter,
  listCharacterIds,
  validateCharacters,
  CHARACTER_LOCALES,
  type ParsedCharacter,
} from "./characters.js";
import {
  subIndex,
  styleOfCopingSub,
  familyOfOriginSub,
  FAMILY_NAME_TO_CODE,
  STYLE_NAME_TO_CODE,
} from "./taxonomy.js";
import {
  buildCoverageMap,
  type CoverageResult,
  type ShippedCellInfo,
} from "./coverage.js";
import { parseRedirectMap } from "./manifest.js";
import { ESCAPE_OID, loadOriginBlocks } from "./origin-blocks.js";

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
function dropUnderscore<T extends Record<string, unknown>>(value: T): T {
  const result = { ...value };
  for (const key of Object.keys(result)) {
    if (key.startsWith("_")) delete result[key];
  }
  return result as T;
}

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
  const C = src.contentDir;
  const includePending = args.includes("--include-pending");

  log("compile-content — Manosaba witch-exam content package");
  log(`  workspace: ${workspace}`);
  log(`  output:    ${src.contentDir}`);
  log("");

  // 0. ship list (seed if absent)
  const shipList = loadJson<{ shipped: string[]; pendingReview?: string[]; characters?: boolean }>(src.shipList);
  const shippedIds = [...shipList.shipped, ...(includePending ? shipList.pendingReview ?? [] : [])];
  const shipCharacters = shipList.characters === true;
  const lockedMeta = loadJson<Meta & { assetsVersion?: string }>(
    join(C, "meta.json"),
  );
  // 1. Compile only the locked quiz STRUCTURE. No question/choice text source
  // is read by this path.
  const copingRaw = dropUnderscore(
    loadJson<CopingTreeRaw>(join(src.scorer, "questions_k.json")),
  );
  const scorerSlots = loadJson<{ slots: string[] }>(
    join(src.scorer, "slots.json"),
  ).slots;
  const originBlocks: OriginBlocks = loadOriginBlocks(src.originV2);
  const nSlots = originBlocks.blocks.flatMap((block) => [
    `${block.id}M`,
    `${block.id}L`,
  ]);
  const slots = [
    ...scorerSlots.filter((slot) => slot.startsWith("K.")),
    ...nSlots,
    ...scorerSlots.filter((slot) => slot.startsWith("V.")),
  ];
  const hashTemplate = loadJson<HashSpec>(
    join(C, "quiz", "hash.spec.json"),
  );
  const redirectRules = parseRedirectMap(src.manifest);
  const warnings: string[] = [...redirectRules.warnings];

  // 2. cards (shipped only)
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

  // 3. characters — parsed before manifest assembly so character-only cells
  // remain represented in the card manifest.
  let characters: ParsedCharacter[] = [];
  if (shipCharacters) {
    characters = listCharacterIds(src.charactersDir).map((id) => {
      try {
        return parseCharacter(id, src.charactersDir);
      } catch (e) {
        throw new Error(`failed to parse character ${id}: ${(e as Error).message}`);
      }
    });
    const shape = validateCharacters(characters); // shape only (no dormancy warn)
    warnings.push(...shape.warnings);
    if (shape.errors.length) {
      throw new Error("COMPILE FAIL — character sources invalid:\n  " + shape.errors.join("\n  "));
    }
  }
  // Character tags as (cell, sub-variant) manifest records. A character whose
  // tag equals a shipped card's tag (e.g. Leia ED-1_P-1) simply reinforces that
  // cell; a character-only tag adds a manifest-only cell.
  interface CharTagInfo {
    tag: string;
    cell: string;
    family: string;
    style: string;
    originSub: string;
    copingSub: string;
  }
  const charTagInfos: CharTagInfo[] = characters.map((c) => {
    const [originSub, copingSub] = c.tag.split("_") as [string, string];
    const family = familyOfOriginSub(originSub);
    const style = styleOfCopingSub(copingSub); // throws on an unknown coping code
    return { tag: c.tag, cell: cellKey(family, style), family, style, originSub, copingSub };
  });

  // 4. derive card/character tags and authored cells
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

  // Weave character tags into the same tag/cell structures. Character-only tags
  // carry an empty `variants` list because they emit no card prose.
  for (const info of charTagInfos) {
    if (!tags.has(info.tag)) {
      tags.set(info.tag, {
        tag: info.tag,
        cell: info.cell,
        family: info.family,
        style: info.style,
        originSub: info.originSub,
        copingSub: info.copingSub,
        variants: [],
      });
    }
    (cellTags.get(info.cell) ?? cellTags.set(info.cell, new Set()).get(info.cell)!).add(info.tag);
  }

  // 5. Card manifest + card-dependent quiz routing indexes.
  const manifestCells: CardsManifest["cells"] = {};
  const manifestTags: CardsManifest["tags"] = {};
  const picksets: PicksetsFile = { redirect: {}, cells: {} };
  const neighbor: NeighborFile = {};
  const variantCounts: Record<string, number> = {};

  // Card tags first, with character-only tags appended for deterministic
  // character and magic-name processing.
  const cardTagList = [...tags.keys()].filter((t) => tags.get(t)!.variants.length > 0).sort();
  const charOnlyTagList = [...tags.keys()].filter((t) => tags.get(t)!.variants.length === 0).sort();
  const orderedTagList = [...cardTagList, ...charOnlyTagList];
  const manifestIndexOf = new Map<string, number>();
  orderedTagList.forEach((tag, index) => manifestIndexOf.set(tag, index));

  // Direct coverage grows with the ship list. Character-only cells resolve
  // themselves but are never used as ordinary-card redirect targets.
  const shippedCells: ShippedCellInfo[] = [];
  const characterOnlyCells: string[] = [];
  for (const [cell, tset] of cellTags) {
    const cellTagIds = [...tset];
    const hasCard = cellTagIds.some(
      (tag) => tags.get(tag)!.variants.length > 0,
    );
    const first = tags.get(cellTagIds[0]!)!;
    if (!hasCard) {
      characterOnlyCells.push(cell);
      continue;
    }
    shippedCells.push({
      cell,
      family: first.family,
      style: first.style,
      tagCount: tset.size,
      manifestOrder: Math.min(
        ...cellTagIds.map((tag) => manifestIndexOf.get(tag)!),
      ),
    });
  }
  const coverage = buildCoverageMap({
    families: Object.values(FAMILY_NAME_TO_CODE),
    styles: Object.keys(STYLE_NAME_TO_CODE),
    styleStance: copingRaw.style_stance,
    shipped: shippedCells,
    manifestRedirect: redirectRules.redirect,
    directOnly: characterOnlyCells,
  });
  picksets.redirect = coverage.redirect;

  for (const [cell, tset] of cellTags) {
    const cellTagIds = [...tset].sort();
    const first = tags.get(cellTagIds[0]!)!;
    const coveredOrigin = [...new Set(cellTagIds.map((t) => tags.get(t)!.originSub))].sort((a, b) => subIndex(a) - subIndex(b));
    const coveredCoping = [...new Set(cellTagIds.map((t) => tags.get(t)!.copingSub))].sort((a, b) => subIndex(a) - subIndex(b));

    picksets.cells[cell] = {
      origin:
        coveredOrigin.length === 1
          ? { auto: coveredOrigin[0]! }
          : { options: coveredOrigin },
      coping:
        coveredCoping.length === 1
          ? { auto: coveredCoping[0]! }
          : { options: coveredCoping },
    };

    const authored: AuthoredTag[] = cellTagIds.map((tag) => {
      const aggregate = tags.get(tag)!;
      return {
        tag,
        origin: aggregate.originSub,
        coping: aggregate.copingSub,
        manifestIndex: manifestIndexOf.get(tag)!,
      };
    });
    const table: Record<string, string> = {};
    const tiers: Record<string, number> = {};
    for (const originSub of coveredOrigin) {
      for (const copingSub of coveredCoping) {
        const resolved = resolveTag(
          originSub,
          copingSub,
          authored,
          subIndex,
          subIndex,
        );
        if (!resolved) {
          throw new Error(
            `coverage gap: no tag for ${originSub} × ${copingSub} in ${cell}`,
          );
        }
        const pair = pickPairKey(originSub, copingSub);
        table[pair] = resolved.tag;
        tiers[pair] = resolved.tier;
      }
    }
    neighbor[cell] = { table, tiers };

    const parsedCell = parseCellKey(cell);
    manifestCells[cell] = {
      family: parsedCell.family,
      style: parsedCell.style,
      authoredTags: cellTagIds,
      coveredOrigin,
      coveredCoping,
    };
  }

  for (const t of orderedTagList) {
    const a = tags.get(t)!;
    // Character-only tags still resolve to variant index 0.
    variantCounts[t] = Math.max(1, a.variants.length);
    // The cards manifest describes shipped CARDS only (its schema requires
    // variants > 0). Character-only tags are rendered from
    // content/characters/*, so they are intentionally absent here.
    if (a.variants.length === 0) continue;
    manifestTags[t] = {
      tag: t,
      cell: a.cell,
      originSub: a.originSub,
      copingSub: a.copingSub,
      variants: a.variants.length,
      locales: [...CARD_LOCALES],
    };
  }

  const cardsManifest: CardsManifest = { tags: manifestTags, cells: manifestCells };
  CardsManifestSchema.parse(cardsManifest);
  PicksetsFileSchema.parse(picksets);
  NeighborFileSchema.parse(neighbor);
  const hashSpec: HashSpec = {
    ...hashTemplate,
    slots,
    variantCounts,
  };
  HashSpecSchema.parse(hashSpec);
  const questions = buildQuestions(slots, copingRaw, originBlocks);
  const contentPackage: ContentPackage = {
    questions,
    copingTree:
      copingRaw as unknown as ContentPackage["copingTree"],
    originBlocks,
    hashSpec,
    picksets,
    neighbor,
    cardsManifest,
  };
  validateContent(contentPackage);

  // 6. Write quiz structure and derived routing. Deliberately do not write any
  // strings.<locale>.json file.
  writeJson(join(C, "quiz", "questions.json"), questions);
  writeJson(join(C, "quiz", "tree.coping.json"), copingRaw);
  writeJson(join(C, "quiz", "blocks.origin.json"), originBlocks);
  rmSync(join(C, "quiz", "tree.origin.json"), { force: true });
  writeJson(join(C, "quiz", "picksets.json"), picksets);
  writeJson(join(C, "quiz", "neighbor.json"), neighbor);
  writeJson(join(C, "quiz", "hash.spec.json"), hashSpec);
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
      for (const loc of CARD_LOCALES) {
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

  // Inputs for meta.assetsVersion (below): every emitted card/character prose
  // artifact, in deterministic emission order.
  const assetHashParts: string[] = [];

  let cardFileCount = 0;
  for (const t of orderedTagList) {
    const a = tags.get(t)!;
    if (a.variants.length === 0) continue; // character-only tag — no card prose
    const files = emitCardLocaleFiles(a);
    for (const [path, obj] of files) {
      writeJson(join(C, "cards", path), obj);
      assetHashParts.push(`${path} ${stableStringify(obj)}`);
      cardFileCount++;
    }
  }

  // 6b. characters — the 13 special character records (design spec §3.7).
  // Gated all-or-nothing by ship_list.json's `"characters"` flag. Parsed and
  // shape-validated above; here we only emit one
  // file per authored locale (content/characters/<locale>.json).
  let characterLocaleFiles = 0;
  if (shipCharacters) {
    const sorted = [...characters].sort((a, b) => a.id.localeCompare(b.id));
    for (const locale of CHARACTER_LOCALES) {
      const records = sorted.map((c) => {
        const f = c.locales[locale]!;
        return {
          id: c.id,
          tag: c.tag,
          color: c.color,
          locale,
          name: c.name[locale]!,
          magicName: c.magicName[locale]!,
          awakening: { before: f.before, after: f.after },
          epithet: f.epithet,
          quote: f.quote,
          // optional per-character warden remark; absent → runtime falls back
          // to the generic i18n template
          ...(f.warden ? { warden: f.warden } : {}),
        };
      });
      writeJson(join(C, "characters", `${locale}.json`), records);
      assetHashParts.push(`characters/${locale}.json ${stableStringify(records)}`);
      characterLocaleFiles++;
    }
  } else {
    // feature off: remove the compiled artifact so the site auto-disables.
    rmSync(join(C, "characters"), { recursive: true, force: true });
  }

  // 7. meta.json. Adding a card can intentionally change the result for an
  // existing answer vector, so routing remains part of contentVersion.
  // assetsVersion busts the runtime /data/ card+character JSON fetches (site
  // delivery contract, design spec §5 revision 2026-07-16).
  const assetsHash = fnv1a32String(assetHashParts.join("\n"));
  const contentHash = fnv1a32String(
    [
      questions,
      copingRaw,
      originBlocks,
      picksets,
      neighbor,
      hashSpec,
    ]
      .map(stableStringify)
      .join(""),
  );
  const meta: Meta & { assetsVersion: string } = {
    ...lockedMeta,
    contentVersion: `0x${(contentHash >>> 0).toString(16).padStart(8, "0")}`,
    assetsVersion: `0x${(assetsHash >>> 0).toString(16).padStart(8, "0")}`,
    generatedAt: new Date().toISOString(),
    counts: {
      ...lockedMeta.counts,
      shippedCards: cards.length,
      shippedTags: tags.size,
      authoredCells: cellTags.size,
      redirects: Object.keys(coverage.redirect).length,
      manifestRedirects: coverage.counts.manifest,
      fallbackRedirects: coverage.counts.fallback,
      cardLocaleFiles: cardFileCount,
      slots: slots.length,
      originBlocks: originBlocks.blocks.length,
      families: Object.keys(FAMILY_NAME_TO_CODE).length,
      styles: Object.keys(STYLE_NAME_TO_CODE).length,
      characters: characters.length,
      characterLocaleFiles,
    },
  };
  writeJson(join(C, "meta.json"), meta);

  report(src, cards, tags, cellTags, coverage, warnings, meta);
}

// ------------------------------------------------------------------ builders
function buildQuestions(
  slots: string[],
  coping: CopingTreeRaw,
  origin: OriginBlocks,
): QuestionsFile {
  const out: QuestionsFile = {};
  const routers = new Set(Object.keys(coping.routers));
  const cores = new Set(Object.keys(coping.cores));
  const tiebreaks = new Set(Object.keys(coping.tiebreaks));
  const probes = new Set(Object.keys(coping.probes));
  const blockById = new Map(
    origin.blocks.map((block) => [block.id, block]),
  );

  for (const qid of slots) {
    if (qid.startsWith("K.")) {
      if (routers.has(qid)) {
        out[qid] = kOpt(
          qid,
          "router",
          coping.routers[qid]!,
          qid === "K.R4",
        );
      } else if (cores.has(qid)) {
        out[qid] = kOpt(qid, "core", coping.cores[qid]!, false);
      } else if (tiebreaks.has(qid)) {
        out[qid] = kOpt(
          qid,
          "tiebreak",
          coping.tiebreaks[qid]!,
          true,
        );
      } else if (probes.has(qid)) {
        out[qid] = kOpt(
          qid,
          "probe",
          probeOptions(coping.probes[qid]!),
          false,
        );
      }
      continue;
    }

    if (/^N\d{2}[ML]$/.test(qid)) {
      const block = blockById.get(qid.slice(0, 3));
      if (!block) throw new Error(`slot ${qid} has no origin block`);
      const most = qid.endsWith("M");
      const options = Object.keys(block.key)
        .sort()
        .map((oid) => ({
          oid,
          votes: { [block.key[oid]!]: most ? 1 : -1 },
        }));
      const entry: Question = {
        qid,
        part: "O",
        kind: most ? "most" : "least",
        stemKey: qid,
        options,
        register: block.register,
      };
      if (most) {
        options.push({ oid: ESCAPE_OID, votes: {} });
        entry.escapeOid = ESCAPE_OID;
      } else {
        entry.displayFilter = true;
      }
      out[qid] = entry;
      continue;
    }

    // V.* choice sets are assembled from the compiled cell picksets at runtime.
    out[qid] = {
      qid,
      part: "V",
      kind: qid === "V.OGROUP" ? "group" : "pick",
      stemKey: qid,
      options: [],
    };
  }
  return out;
}

function kOpt(
  qid: string,
  kind: Question["kind"],
  map: Record<string, string>,
  displayFilter: boolean,
): Question {
  const question: Question = {
    qid,
    part: "K",
    kind,
    stemKey: qid,
    options: Object.entries(map).map(([oid, label]) => ({
      oid,
      votes: { [label]: 1 },
    })),
  };
  if (displayFilter) question.displayFilter = true;
  return question;
}

function probeOptions(
  entry: Record<string, string | boolean>,
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key !== "category" && key !== "new_slot") {
      options[key] = value as string;
    }
  }
  return options;
}

function emitCardLocaleFiles(
  agg: { tag: string; cell: string; family: string; style: string; originSub: string; copingSub: string; variants: ParsedCard[] },
): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const locale of CARD_LOCALES) {
    const variants = agg.variants.map((c) => ({
      variant: c.variant,
      fields: c.locales[locale] ?? emptyFields(),
    }));
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
  const gridSize =
    Object.keys(FAMILY_NAME_TO_CODE).length *
    Object.keys(STYLE_NAME_TO_CODE).length;
  const { direct, manifest, fallback, tier } = coverage.counts;
  const characterCovered = cellTags.size - direct;

  log("");
  log("=== COMPILE REPORT ===");
  log(`  locked quiz rules: ${meta.quizVersion}   contentVersion: ${meta.contentVersion}`);
  log(`  shipped cards:  ${cards.length}   shipped tags: ${tags.size}   authored cells: ${cellTags.size}`);
  log(`  card locale files: ${meta.counts.cardLocaleFiles}`);
  log(
    `  characters:     ${
      meta.counts.characters
        ? `${meta.counts.characters} (${meta.counts.characterLocaleFiles} locale files)`
        : "off (ship_list.characters !== true)"
    }`,
  );
  log("");
  log(
    `  TOTAL cell coverage of the ${gridSize}-cell grid ` +
      `(invariant: 0 uncovered):`,
  );
  log(`    direct (shipped-covered):   ${direct}`);
  log(`    character-covered (§3.7):   ${characterCovered}`);
  log(`    manifest-redirect (§3):     ${manifest}`);
  log(`    fallback-redirect (tiers):  ${fallback}`);
  log(`    ---------------------------------`);
  log(
    `    total:                      ${
      direct + characterCovered + manifest + fallback
    }`,
  );
  log("");
  log("  fallback-redirect tier distribution:");
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
  log(`  wrote derived routing + card/character content under ${src.contentDir}`);
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

main();
