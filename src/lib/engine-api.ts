/*
 * Quiz-engine seam (design spec §4). The whole examination flow drives against
 * this interface, so the deterministic scorer can be swapped in as one module
 * (see engine.ts) without touching the UI. The real engine will be
 * `@manosaba/engine` (built by a sibling agent); MockEngine implements the same
 * shape today so the flow is drivable end-to-end.
 */
import type { Locale } from '../i18n/config'

/** Narrative phase of the examination — never a numeric total (adaptive). */
export type ExamPhase = 'observe' | 'deep' | 'match' // 観測 / 深層 / 照合

/** One candidate cell the engine may resolve to, drawn from the manifest. */
export interface CellCandidate {
  tag: string
  cell: string
  origin: string
  coping: string
}

/** What createExam consumes — the scored content package for one locale. */
export interface ExamContent {
  locale: Locale
  quizVersion: string
  /**
   * Authored cells available to resolve to. Consumed ONLY by the dev mock
   * engine (which fabricates a result from them and defaults to mock-cells.ts
   * when absent); the real adapter resolves from its compiled rule tables and
   * ignores this entirely — the UI no longer supplies it.
   */
  cells?: CellCandidate[]
}

export interface ExamOption {
  id: string
  /** Localized display text (bone-on-velvet option card). */
  label: string
  /**
   * Shown but not answerable — the option is rendered dimmed/locked and emits
   * no answer. Used by the origin "least" screen to echo the "most" pick (you
   * cannot mark the same line most and least). Absent/false on normal options.
   */
  disabled?: boolean
}

export interface ExamQuestion {
  id: string
  phase: ExamPhase
  /** Localized scenario text (body serif). */
  prompt: string
  options: ExamOption[]
  /** Back permitted from here (scorer-gated). */
  canGoBack: boolean
}

export interface ExamProgress {
  phase: ExamPhase
  /** Questions answered so far. */
  answered: number
  /** 1-based ordinal of the current question, for the readout. */
  ordinal: number
  /** Soft 0..1 resonance for the gauge — NOT a completion percentage. */
  resonance: number
}

export interface ExamResult {
  /** Resolved authored card tag. */
  tag: string
  /** Resolved cell key (origin × coping). */
  cell: string
  origin: string
  coping: string
  /** Optional sanitized witch name carved into the record. */
  witchName?: string
  quizVersion: string
  /**
   * Everything a feedback report needs to reproduce this routing (the pre-redirect
   * cell, the served variant, an answers fingerprint, and the exact answer
   * sequence). Optional — populated by the real engine adapter; the mock omits it.
   * NOT part of the persisted snapshot and never shown in-world.
   */
  debug?: ExamDebug
}

/**
 * Everything the feedback triage needs to answer "why did this visitor get a
 * card that feels wrong?" without re-running anything. The top of the block is
 * the *outcome* (cell, redirect, served tag/variant); the rest is the *raw
 * decision conditions* that produced it — the origin per-family sums and coping
 * per-style votes behind each argmax (so a near-tie is visible as a near-tie),
 * the stance routing, whatever tiebreak/guard swung the coping style, the
 * pick-tail sub-variant that chose the exact tag within the cell, and any
 * resolution anomaly flags. None of this is shown in-world.
 */
export interface ExamDebug {
  /** Raw cell "F|S" the hard-axes walk scored to, before any neighbor redirect. */
  resolvedCell: string
  /** Landed cell "F|S" after redirect; equals resolvedCell when none fired. */
  landedCell: string
  /** Whether the neighbor redirect table moved resolvedCell → landedCell. */
  redirected: boolean
  /** Served authored variant index. */
  variantIndex: number
  /** How far the served tag sits from the picked pair in its cell (0 = exact
   *  authored hit; higher = a neighbor fallback stood in — a prime "this isn't
   *  me" cause even when the cell itself is right). */
  tier: number
  /** FNV-1a fingerprint of the resolved answers (identifies the answer-set even
   *  if the reporter deletes the raw answers below). */
  answersHash: number

  // ---- origin axis (which family — the dominant driver of card identity) ----
  /** Resolved origin family and the runner-up it beat (top2[1]). */
  originFamily: string
  originRunnerUp: string | null
  /** Per-family sums S — the raw argmax input; a 4-vs-3 top-two reads as a
   *  near-tie here. Zero-score families are dropped. */
  originSums: Record<string, number>
  /** Per-family most-mine counts — the first origin tie-break key. */
  originMostCounts: Record<string, number>

  // ---- coping axis (which style) ----
  /** Resolved style, its true stance, HIGH/MODERATE confidence, and runner-up. */
  copingStyle: string
  copingStance: string
  copingConfidence: string
  copingRunnerUp: string | null
  /** Raw 3-vote core tally behind the style argmax (pre-tiebreak/guard). */
  copingCoreTally: Record<string, number>
  /** Stance routing: entered block, shadow, and the router votes behind them. */
  stanceVotes: Record<string, number>
  enteredBlock: string | null
  shadowStance: string | null
  /** The tiebreak that broke a core-tally tie (qid + voted style), if any. */
  tiebreak?: { qid: string; voted: string | null; abstained: boolean } | null
  /** The guard that confirmed or flipped the style (from → to), if any. */
  guard?: { qid: string; outcome: string; from: string; to: string } | null

  // ---- pick tail (which exact tag within the cell) ----
  /** Sub-variant picks (origin × coping) that selected the served tag. */
  originPick: string
  copingPick: string
  /** Two-stage origin group, when the cell routed through V.OGROUP. */
  originGroup?: string

  /** Resolution anomaly flags (filter violations, ml conflicts, degraded slots). */
  flags: string[]
  /** Ordered answer option-ids — the exact input to replay the routing. */
  answers: string[]
}

export interface ExamSession {
  /** The current question, or null once the exam is done. */
  current(): ExamQuestion | null
  /** Record an answer and advance. Unknown option ids are ignored. */
  answer(optionId: string): void
  /** Step back one question if permitted. */
  back(): void
  canGoBack(): boolean
  progress(): ExamProgress
  isDone(): boolean
  /**
   * True once the exam is done but the resolved cell has no authored card
   * (soft-launch coverage gap). The flow shows a graceful "no record" screen
   * instead of a verdict. Optional so the mock engine (which always lands on an
   * authored cell) need not implement it.
   */
  isInconclusive?(): boolean
  /** Carve the (already-sanitized) name into the pending record. */
  setWitchName(name: string | undefined): void
  /** The verdict, once isDone(). Null before then. */
  result(): ExamResult | null
  /** Serialize answers for localStorage persistence. */
  snapshot(): ExamSnapshot
  /** Restore from a snapshot (same content hash). */
  restore(snapshot: ExamSnapshot): void
}

export interface ExamSnapshot {
  answers: string[]
  witchName?: string
}

/** The factory the UI calls. engine.ts re-exports the active implementation. */
export type CreateExam = (content: ExamContent) => ExamSession
