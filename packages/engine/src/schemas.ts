/**
 * Zod schemas + inferred types for every runtime content artifact.
 *
 * These are the single source of truth for the shape of the compiled `content/`
 * package. The engine validates against them on load (opt-in); the compiler
 * validates its output against them before writing (fail-loud). The coping /
 * origin tree shapes deliberately mirror the CERTIFIED reference tables
 * (`questions_k.json` / `questions_o.json` / `prior.json`) so the deterministic
 * evaluator is a byte-faithful port of the reference scorer (see DECISIONS.md).
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

// ----------------------------------------------------------------- origin tree
/** oid -> {family: points}. */
const FamilyVoteMap = z.record(NonEmpty, z.number().int());

export const OriginQuestionSchema = z.object({
  kind: z.enum([
    "router",
    "separation",
    "discriminator",
    "alternate",
  ]),
  new_slot: z.boolean().optional(),
  pair: z.tuple([NonEmpty, NonEmpty]).optional(),
  escape: z.string().nullable().optional(),
  alternate: z.string().nullable().optional(),
  options: z.record(NonEmpty, FamilyVoteMap),
});
export type OriginQuestion = z.infer<typeof OriginQuestionSchema>;

export const PriorRowSchema = z.object({
  tier1: z.array(NonEmpty),
  tier2: z.array(NonEmpty),
  prearm: z.array(NonEmpty),
});
export type PriorRow = z.infer<typeof PriorRowSchema>;

export const OriginMechanismSchema = z.object({
  liveness_top_k: z.number().int(),
  liveness_gap: z.number().int(),
  liveness_gap_prearmed: z.number().int(),
  disc_cap: z.number().int(),
  alternate_gap: z.number().int(),
  separation_blocks: z.number().int(),
  c1_near_tie_gap: z.number().int(),
  c1_third_option_gap: z.number().int(),
  c1_escaped_pair_trigger: z.boolean(),
});
export type OriginMechanism = z.infer<typeof OriginMechanismSchema>;

export const OriginTreeSchema = z.object({
  mechanism: OriginMechanismSchema,
  families: z.array(NonEmpty),
  precedence: z.array(NonEmpty),
  clusters: z.record(NonEmpty, z.array(NonEmpty)),
  cluster_block: z.record(NonEmpty, NonEmpty),
  questions: z.record(NonEmpty, OriginQuestionSchema),
  pairs: z.array(
    z.object({
      pair: z.tuple([NonEmpty, NonEmpty]),
      primary: NonEmpty,
      alternate: z.string().nullable(),
      bank: z.enum(["P", "B"]),
      num: z.number().int(),
    }),
  ),
  frozen_pairs: z.array(z.tuple([NonEmpty, NonEmpty])),
  uncovered_pairs: z.array(z.tuple([NonEmpty, NonEmpty])),
  wanted_lines: z.record(NonEmpty, z.string()),
  /** 25-row coping-style -> origin prior table (folded in from prior.json). */
  prior: z.record(NonEmpty, PriorRowSchema),
});
export type OriginTree = z.infer<typeof OriginTreeSchema>;

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
    "separation",
    "discriminator",
    "alternate",
    "confirmation",
    "group",
    "pick",
  ]),
  stemKey: z.string(),
  options: z.array(QuestionOptionSchema),
  displayFilter: z.boolean().optional(),
  escapeOid: z.string().nullable().optional(),
  alternateOf: z.string().nullable().optional(),
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
  originTree: OriginTreeSchema,
  hashSpec: HashSpecSchema,
  picksets: PicksetsFileSchema.optional(),
  neighbor: NeighborFileSchema.optional(),
  cardsManifest: CardsManifestSchema.optional(),
});
export type ContentPackage = z.infer<typeof ContentPackageSchema>;
