/*
 * Site-side adapter over the real deterministic engine (packages/engine),
 * conforming the engine's session to the UI seam in engine-api.ts.
 *
 * This module is deliberately free of any Vite/Astro-specific imports (no
 * import.meta.glob) so it can be unit-driven under plain Node/tsx against a
 * ContentPackage built from disk. engine.ts binds it to the compiled
 * QUIZ_CONTENT and picks real-vs-mock.
 *
 * API drift the adapter absorbs (real session -> UI seam):
 *  - QuestionInstance {qid, part, kind, phase:'coping'|'origin'|'picks', stem,
 *    options:[{oid,text}]}  ->  ExamQuestion {id, phase:'observe'|'deep'|'match',
 *    prompt, options:[{id,label}], canGoBack}.
 *  - ExamResult {cell:{family,style}, picks, tag, tier, variantIndex, ...} ->
 *    {tag, cell:"F|S", origin, coping, witchName?, quizVersion}.
 *  - No setWitchName/snapshot/restore on the real session: the adapter keeps the
 *    witch name locally and persists the raw answer-oid sequence, replaying it to
 *    restore (the walk is pure, so replay is exact).
 *  - The real session throws ExamError from its lazy step when the hard-axes walk
 *    lands on a cell with no authored coverage (soft-launch gap). The adapter
 *    catches that and reports isInconclusive() instead of throwing through the UI.
 *  - Pick-option display permutation is presentation-only and already applied by
 *    the engine; options are rendered in the exact order the engine emits them.
 */
import {
  createExam as createRealExam,
  ExamError,
  type ExamSession as EngineSession,
  type QuestionInstance,
  type ExamResult as EngineResult,
  type ContentPackage,
  type Phase as EnginePhase,
} from '@manosaba/witch-exam-engine'
import type {
  CreateExam,
  ExamContent,
  ExamSession,
  ExamQuestion,
  ExamProgress,
  ExamResult,
  ExamSnapshot,
  ExamPhase,
} from './engine-api'

const PHASE_MAP: Record<EnginePhase, ExamPhase> = {
  coping: 'observe',
  origin: 'deep',
  picks: 'match',
}

// Nominal sizes for the resonance gauge. Origin is derived per-package from the
// real block count (see estTotal); coping length is captured at runtime once the
// walk crosses into origin; only the short pick tail (0..3) is estimated.
const COPING_EST = 8 // stand-in until the real coping length is known
const PICKS_EST = 2 // the pick tail is the last 0..3 screens

function mapQuestion(q: QuestionInstance, canGoBack: boolean): ExamQuestion {
  const options: ExamQuestion['options'] = q.options.map((o) => ({
    id: o.oid,
    label: o.text,
  }))
  const disabled = q.disabledOptions ?? []
  if (disabled.length) {
    // Merge the locked options back in and restore canonical (oid) order so the
    // "least" screen reads like its "most" screen with one line greyed in place.
    for (const o of disabled) options.push({ id: o.oid, label: o.text, disabled: true })
    options.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  return {
    id: q.qid,
    phase: PHASE_MAP[q.phase] ?? 'observe',
    prompt: q.stem,
    options,
    canGoBack,
  }
}

type View = { done: boolean; inconclusive: boolean; question: ExamQuestion | null }

export class RealExamSession implements ExamSession {
  private engine: EngineSession
  private readonly log: string[] = []
  private witchName: string | undefined
  private view: View = { done: false, inconclusive: false, question: null }
  /** Actual coping question count, captured once the walk enters origin; null
   *  while still in coping (and reset if the user steps back into it). Lets the
   *  resonance gauge size itself to this session's real length. */
  private copingLen: number | null = null

  constructor(
    private readonly pkg: ContentPackage,
    private readonly content: ExamContent,
  ) {
    this.engine = createRealExam(pkg)
    this.recompute()
  }

  /** Re-derive the cached view from the engine's lazy step, absorbing the
   * uncovered-cell ExamError as a graceful inconclusive terminal. */
  private recompute(): void {
    try {
      if (this.engine.isDone()) {
        this.view = { done: true, inconclusive: false, question: null }
        return
      }
      const q = this.engine.current()
      this.view = q
        ? { done: false, inconclusive: false, question: mapQuestion(q, this.engine.canGoBack()) }
        : { done: true, inconclusive: false, question: null }
      // Snapshot the coping length at the coping→origin boundary. The current
      // question is the *next* one to answer, so when it is the first origin
      // (or pick) screen, log.length is exactly the coping count.
      const phase = this.view.question?.phase
      if (phase === 'observe') this.copingLen = null
      else if (phase && this.copingLen === null) this.copingLen = this.log.length
    } catch (e) {
      if (e instanceof ExamError) {
        this.view = { done: true, inconclusive: true, question: null }
        return
      }
      throw e
    }
  }

  current(): ExamQuestion | null {
    return this.view.question
  }

  answer(optionId: string): void {
    const q = this.view.question
    if (!q) return
    if (!q.options.some((o) => o.id === optionId)) return // unknown ids ignored
    this.engine.answer(optionId)
    this.log.push(optionId)
    this.recompute()
  }

  back(): void {
    if (!this.engine.canGoBack()) return
    this.engine.back()
    this.log.pop()
    this.recompute()
  }

  canGoBack(): boolean {
    return this.engine.canGoBack()
  }

  progress(): ExamProgress {
    const answered = this.log.length
    const phase: ExamPhase = this.view.question ? this.view.question.phase : 'match'
    // Size the gauge to this session's real length: actual coping + the fixed
    // origin block count (×2 for most/least) + the short pick tail. Origin is
    // read from the package, so growing the bank re-sizes the gauge for free.
    const originTotal = this.pkg.originBlocks.blocks.length * 2
    const total = (this.copingLen ?? COPING_EST) + originTotal + PICKS_EST
    const resonance = Math.min(0.995, answered / total)
    return { phase, answered, ordinal: answered + 1, resonance }
  }

  isDone(): boolean {
    return this.view.done
  }

  isInconclusive(): boolean {
    return this.view.inconclusive
  }

  setWitchName(name: string | undefined): void {
    this.witchName = name
  }

  result(): ExamResult | null {
    if (!this.view.done || this.view.inconclusive) return null
    const r: EngineResult = this.engine.result()
    const landed = r.redirectedCell ?? r.cell
    return {
      tag: r.tag,
      cell: `${landed.family}|${landed.style}`,
      origin: landed.family,
      coping: landed.style,
      witchName: this.witchName,
      quizVersion: this.content.quizVersion,
      debug: {
        resolvedCell: `${r.cell.family}|${r.cell.style}`,
        landedCell: `${landed.family}|${landed.style}`,
        variantIndex: r.variantIndex,
        answersHash: r.answersHash,
        answers: [...this.log],
      },
    }
  }

  snapshot(): ExamSnapshot {
    return { answers: [...this.log], witchName: this.witchName }
  }

  restore(snapshot: ExamSnapshot): void {
    // Rebuild from a clean session and replay the recorded oid sequence. The
    // hard-axes walk is pure, so replay reproduces the exact state; any oid that
    // no longer applies (content changed under the save) stops the replay.
    this.engine = createRealExam(this.pkg)
    this.log.length = 0
    this.copingLen = null
    this.witchName = snapshot.witchName
    this.recompute()
    for (const oid of snapshot.answers) {
      const q = this.view.question
      if (!q || !q.options.some((o) => o.id === oid)) break
      this.engine.answer(oid)
      this.log.push(oid)
      this.recompute()
      if (this.view.done) break
    }
  }
}

/**
 * Bind the adapter to a specific ContentPackage, yielding the UI's factory.
 * When a per-locale strings map is supplied, the session's display strings are
 * swapped to the requested locale (falling back to the package's base strings
 * for locales that were not compiled); resolution/hashing are text-independent,
 * so only display prose changes.
 */
export function makeRealCreateExam(
  pkg: ContentPackage,
  stringsByLocale?: Record<string, ContentPackage['strings']>,
): CreateExam {
  return (content) => {
    const localized = stringsByLocale?.[content.locale]
    const bound =
      localized && localized !== pkg.strings ? { ...pkg, strings: localized } : pkg
    return new RealExamSession(bound, content)
  }
}
