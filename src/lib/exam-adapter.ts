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

// Soft resonance for the gauge — a gentle climb that never claims completion
// (the exam is adaptive; there is no fixed total). NOT a progress percentage.
function resonanceFor(answered: number): number {
  return Math.min(0.96, 0.08 + answered * 0.06)
}

function mapQuestion(q: QuestionInstance, canGoBack: boolean): ExamQuestion {
  return {
    id: q.qid,
    phase: PHASE_MAP[q.phase] ?? 'observe',
    prompt: q.stem,
    options: q.options.map((o) => ({ id: o.oid, label: o.text })),
    canGoBack,
  }
}

type View = { done: boolean; inconclusive: boolean; question: ExamQuestion | null }

export class RealExamSession implements ExamSession {
  private engine: EngineSession
  private readonly log: string[] = []
  private witchName: string | undefined
  private view: View = { done: false, inconclusive: false, question: null }

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
    return {
      phase,
      answered,
      ordinal: answered + 1,
      resonance: resonanceFor(answered),
    }
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

/** Bind the adapter to a specific ContentPackage, yielding the UI's factory. */
export function makeRealCreateExam(pkg: ContentPackage): CreateExam {
  return (content) => new RealExamSession(pkg, content)
}
