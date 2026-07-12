/**
 * Zod schemas + inferred types for every runtime content artifact.
 *
 * These are the single source of truth for the shape of the compiled `content/`
 * package. The engine validates against them on load (opt-in); the compiler
 * validates its output against them before writing (fail-loud). The coping tree
 * shape deliberately mirrors the CERTIFIED reference table (`questions_k.json`)
 * so the coping evaluator stays a byte-faithful port of the reference scorer;
 * the origin-v2 block shape mirrors the locked `score_v2.py` KEY table
 * (see DECISIONS.md D11).
 */
import { z } from "zod";

// ----------------------------------------------------------------- primitives
const NonEmpty = z.string().min(1);

/** oid -> label (stance for routers, style for cores/tie-breaks). */
const LabelMap = z.record(NonEmpty, NonEmpty);

// ----------------------------------------------------------------- coping tree
/**
 * A probe entry carries option letters (oid -> style, string values) plus the
 * metadata keys `category` and `new_slot`. Catchall covers the option letters.
 */
export const ProbeEntrySchema = z
  .object({
    category: z.string().optional(),
    new_slot: z.boolean().optional(),
  })
  .catchall(NonEmpty);
export type ProbeEntry = z.infer<typeof ProbeEntrySchema>;

export const CopingTreeSchema = z.object({
  stances: z.array(NonEmpty),
  stance_prior_order: z.array(NonEmpty),
  style_stance: z.record(NonEmpty, NonEmpty),
  block_prior_order: z.record(NonEmpty, z.array(NonEmpty)),
  block_cores: z.record(NonEmpty, z.array(NonEmpty)),
  block_tiebreak: z.record(NonEmpty, NonEmpty),
  cross_keys: z.record(
    NonEmpty,
    z.array(
      z.object({ style: NonEmpty, probe: NonEmpty, partner: NonEmpty }),
    ),
  ),
  routers: z.record(NonEmpty, LabelMap),
  cores: z.record(NonEmpty, LabelMap),
  tiebreaks: z.record(NonEmpty, LabelMap),
  probes: z.record(NonEmpty, ProbeEntrySchema),
  listed_pairs: z.array(
    z.object({ pair: z.tuple([NonEmpty, NonEmpty]), probe: NonEmpty }),
  ),
  stance_leak_rows: z.array(z.tuple([NonEmpty, NonEmpty])),
  mask_guards: z.record(NonEmpty, NonEmpty),
  function_guards: z.record(NonEmpty, NonEmpty),
  shadow_guards: z.array(
    z.object({ style: NonEmpty, shadow: NonEmpty, probe: NonEmpty }),
  ),
});
export type CopingTree = z.infer<typeof CopingTreeSchema>;

// ----------------------------------------------------------------- origin blocks (v2)
/**
 * Origin v2 instrument (`blocks.origin.json`): 14 recognition blocks
 * (2-(8,4,3) BIBD), each a 4-line screen keyed one-line-one-family. Two slots
 * per block: `<id>M` (most-mine, +1, escape oid votes nothing) and `<id>L`
 * (least-mine, -1, must differ from M unless M escaped). Resolution is
 * sum/argmax with tie-break (most-count, then `families` canonical order).
 * Replaces the v1 origin tree (prior/routers/separations/discriminators/C1).
 */
export const OriginBlockSchema = z.object({
  /** block id, e.g. "N01"; slots are `${id}M` / `${id}L`. */
  id: NonEmpty,
  /** register (stem-key grouping): scenes/sentences/hums/rules/weather/needed/stings. */
  register: NonEmpty,
  /** option letter -> keyed family (exactly A-D; the escape oid is NOT a key). */
  key: z.record(NonEmpty, NonEmpty),
});
export type OriginBlock = z.infer<typeof OriginBlockSchema>;

export const OriginBlocksSchema = z.object({
  version: NonEmpty,
  /** escape oid on M screens (votes nothing), e.g. "E". */
  escape: NonEmpty,
  /** all families in canonical tie-break order (ABN < ED < ... < POW). */
  families: z.array(NonEmpty).min(2),
  /** blocks in ask order (N01..N14). */
  blocks: z.array(OriginBlockSchema).min(1),
});
export type OriginBlocks = z.infer<typeof OriginBlocksSchema>;

// ----------------------------------------------------------------- hash spec
export const HashSpecSchema = z.object({
  bankVersion: NonEmpty,
  manifestVersion: NonEmpty.optional(),
  slots: z.array(NonEmpty),
  sentinel: NonEmpty,
  fnv: z.object({ offset: z.number().int(), prime: z.number().int() }),
  newInV3: z.array(NonEmpty).optional(),
  /** tag id -> variant count N (N=1 => index 0, no hash needed). */
  variantCounts: z.record(NonEmpty, z.number().int().positive()),
  permutation: z.object({
    prng: z.literal("xorshift32"),
    shuffle: z.literal("fisher-yates-descending"),
    prePickPrefix: z.string(),
    withinGroupSeed: z.string(),
  }),
});
export type HashSpec = z.infer<typeof HashSpecSchema>;

// ----------------------------------------------------------------- questions (display)
export const QuestionOptionSchema = z.object({
  oid: NonEmpty,
  votes: z.record(NonEmpty, z.number().int()).optional(),
});
export const QuestionSchema = z.object({
  qid: NonEmpty,
  part: z.enum(["K", "O", "V"]),
  kind: z.enum([
    "router",
    "core",
    "tiebreak",
    "probe",
    "most",
    "least",
    "group",
    "pick",
  ]),
  stemKey: z.string(),
  options: z.array(QuestionOptionSchema),
  displayFilter: z.boolean().optional(),
  escapeOid: z.string().nullable().optional(),
  /** origin-v2 register of an N-block slot (stem grouping). */
  register: z.string().optional(),
});
export type Question = z.infer<typeof QuestionSchema>;
export const QuestionsFileSchema = z.record(NonEmpty, QuestionSchema);
export type QuestionsFile = z.infer<typeof QuestionsFileSchema>;

/** strings.<locale>.json: display text for stems + options. */
export const StringsFileSchema = z.object({
  locale: NonEmpty,
  questions: z.record(
    NonEmpty,
    z.object({
      stem: z.string(),
      options: z.record(NonEmpty, z.string()),
    }),
  ),
});
export type StringsFile = z.infer<typeof StringsFileSchema>;

// ----------------------------------------------------------------- picksets
export const PickAxisSchema = z.union([
  z.object({ auto: NonEmpty }),
  z.object({ options: z.array(NonEmpty).min(2) }),
  z.object({
    twoStage: z.object({
      groups: z.array(
        z.object({ gid: NonEmpty, options: z.array(NonEmpty).min(1) }),
      ),
    }),
  }),
]);
export type PickAxis = z.infer<typeof PickAxisSchema>;

export const PicksetCellSchema = z.object({
  redirect: NonEmpty.optional(),
  origin: PickAxisSchema,
  coping: PickAxisSchema,
});
export type PicksetCell = z.infer<typeof PicksetCellSchema>;

export const PicksetsFileSchema = z.object({
  /** raw (unauthored) cell -> authored target cell key. */
  redirect: z.record(NonEmpty, NonEmpty),
  /** authored cell key -> pick composition. */
  cells: z.record(NonEmpty, PicksetCellSchema),
});
export type PicksetsFile = z.infer<typeof PicksetsFileSchema>;

// ----------------------------------------------------------------- neighbor
export const NeighborCellSchema = z.object({
  /** `${o}|${c}` -> served tag id. */
  table: z.record(NonEmpty, NonEmpty),
  /** parallel table of tier (0..3) for diagnostics. */
  tiers: z.record(NonEmpty, z.number().int().min(0).max(3)).optional(),
});
export type NeighborCell = z.infer<typeof NeighborCellSchema>;
export const NeighborFileSchema = z.record(NonEmpty, NeighborCellSchema);
export type NeighborFile = z.infer<typeof NeighborFileSchema>;

// ----------------------------------------------------------------- cards manifest
export const ManifestTagSchema = z.object({
  tag: NonEmpty,
  cell: NonEmpty,
  originSub: NonEmpty,
  copingSub: NonEmpty,
  variants: z.number().int().positive(),
  locales: z.array(NonEmpty),
});
export type ManifestTag = z.infer<typeof ManifestTagSchema>;

export const ManifestCellSchema = z.object({
  family: NonEmpty,
  style: NonEmpty,
  authoredTags: z.array(NonEmpty),
  coveredOrigin: z.array(NonEmpty),
  coveredCoping: z.array(NonEmpty),
  redirect: NonEmpty.optional(),
});
export type ManifestCell = z.infer<typeof ManifestCellSchema>;

export const CardsManifestSchema = z.object({
  tags: z.record(NonEmpty, ManifestTagSchema),
  cells: z.record(NonEmpty, ManifestCellSchema),
});
export type CardsManifest = z.infer<typeof CardsManifestSchema>;

// ----------------------------------------------------------------- meta
export const MetaSchema = z.object({
  contentVersion: NonEmpty,
  quizVersion: NonEmpty,
  bankVersion: NonEmpty,
  manifestVersion: NonEmpty.optional(),
  generatedAt: NonEmpty,
  counts: z.record(NonEmpty, z.number().int()),
  locales: z.array(NonEmpty),
});
export type Meta = z.infer<typeof MetaSchema>;

// ----------------------------------------------------------------- content package
/**
 * The full runtime content the engine consumes. `questions` / `strings` power
 * the session UI; the tree tables + hashSpec power resolution; picksets +
 * neighbor power the tail. `cardsManifest` and `strings` are optional for the
 * pure resolver.
 */
export const ContentPackageSchema = z.object({
  meta: MetaSchema.optional(),
  questions: QuestionsFileSchema.optional(),
  /** display text for the session's selected locale (optional for scoring). */
  strings: StringsFileSchema.optional(),
  copingTree: CopingTreeSchema,
  originBlocks: OriginBlocksSchema,
  hashSpec: HashSpecSchema,
  picksets: PicksetsFileSchema.optional(),
  neighbor: NeighborFileSchema.optional(),
  cardsManifest: CardsManifestSchema.optional(),
});
export type ContentPackage = z.infer<typeof ContentPackageSchema>;
