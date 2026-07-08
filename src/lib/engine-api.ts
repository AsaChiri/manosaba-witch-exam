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
  /** Authored cells available to resolve to (from the content manifest). */
  cells: CellCandidate[]
}

export interface ExamOption {
  id: string
  /** Localized display text (bone-on-velvet option card). */
  label: string
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
