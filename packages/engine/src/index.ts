/**
 * @manosaba/witch-exam-engine — deterministic quiz scorer, tag resolution and
 * types for the Manosaba witch-factor examination (v3-89).
 *
 * No Date.now / Math.random anywhere in any resolution path. Every result is a
 * pure function of the answer vector + the content package.
 */

// Public session API
export {
  createExam,
  ExamError,
  type ExamSession,
  type ExamResult,
  type QuestionInstance,
  type CreateExamOptions,
  type Phase,
} from "./session.js";

// Full-map resolution (validation / server-side scoring) + record types
export {
  resolveHardAxes,
  prepareTrees,
  Walker,
  Pending,
  ScorerError,
  probeOptions,
  type Prepared,
  type Mode,
  type AnswerMap,
  type AnswerValue,
  type ScoreRecord,
  type TieResolverRec,
  type GuardRec,
  type C1Rec,
  type TraceEntry,
} from "./resolver.js";

// Deterministic primitives
export {
  fnv1a32,
  fnv1a32String,
  canonicalString,
  FNV_OFFSET_BASIS,
  FNV_PRIME,
} from "./hash.js";
export { xorshift32, seedFromString, permute } from "./permute.js";

// Tag resolution + variant selection
export {
  resolveTag,
  selectVariant,
  subvariantIndex,
  type AuthoredTag,
  type TagResult,
} from "./tags.js";

// Keys
export { cellKey, pickPairKey, parseCellKey } from "./keys.js";

// Content validation
export { validateContent } from "./validate.js";

// Content-artifact schemas + inferred types
export * from "./schemas.js";
