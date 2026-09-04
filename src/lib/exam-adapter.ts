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

/** Drop zero-score entries so the feedback block shows only families that
 *  actually moved (the origin sum/most maps carry a slot for every family). */
function nonZero(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(m)) if (v !== 0) out[k] = v
  return out
}

// Nominal screen counts for the readout ("第 n 问 · 共约 N 问") and the gauge.
// Origin is read per-package from the real block count (one SCREEN per block:
// its most/least pair shares a screen); coping length is captured at runtime
// once the walk crosses into origin (observed 6–7); only the short pick tail
// (0..2 screens, usually 1) is estimated.
const COPING_EST = 7 // stand-in until the real coping length is known
const PICKS_EST = 1 // the pick tail is the last 0..2 screens

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
  // Origin most/least pairs (N01M / N01L …) render as ONE screen in the UI.
  const pair = q.kind === 'most' ? 'most' : q.kind === 'least' ? 'least' : undefined
  const blockId = pair && /[ML]$/.test(q.qid) ? q.qid.slice(0, -1) : undefined
  return {
    id: q.qid,
    phase: PHASE_MAP[q.phase] ?? 'observe',
    prompt: q.stem,
    options,
    canGoBack,
    ...(pair ? { pair } : {}),
    ...(blockId ? { blockId } : {}),
  }
}

type View = { done: boolean; inconclusive: boolean; question: ExamQuestion | null }

export class RealExamSession implements ExamSession {
  private engine: EngineSession
  private readonly log: string[] = []
  /** Parallel to `log`: 'least' for answers given on a least step, so the
   *  screen ordinal can count a most/least pair once. */
  private readonly steps: string[] = []
  /** Parallel to `log`: the UI phase each answer was given in, so the coping
   *  length can be counted whatever order the engine walks the axes in. */
  private readonly phases: ExamPhase[] = []
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
    this.steps.push(q.pair ?? '')
    this.phases.push(q.phase)
    this.recompute()
  }

  back(): void {
    if (!this.engine.canGoBack()) return
    this.engine.back()
    this.log.pop()
    this.steps.pop()
    this.phases.pop()
    this.recompute()
  }

  canGoBack(): boolean {
    return this.engine.canGoBack()
  }

  progress(): ExamProgress {
    const answered = this.log.length
    const cur = this.view.question
    const phase: ExamPhase = cur ? cur.phase : 'match'
    // Screens, not engine questions: a most/least pair shares one screen, so a
    // least answer does not advance the ordinal and a pending least step still
    // belongs to the screen its most answer opened.
    // A most answer already advances screensDone by one while its least step
    // is still pending, so the least step counts as HALF a screen back from
    // that — never half a screen forward, which made the gauge dip at every
    // block boundary (bug found 2026-09-03).
    const screensDone = answered - this.steps.filter((s) => s === 'least').length
    const onLeast = cur?.pair === 'least'
    const ordinal = onLeast ? screensDone : screensDone + 1
    const progressed = onLeast ? screensDone - 0.5 : screensDone
    // Size the readout to this session's real length: one screen per origin
    // block + the coping count (actual once the walk has left coping; while
    // it runs, the nominal estimate or the screens already seen, whichever is
    // larger — a tiebreak/guard can push coping past the estimate) + the short
    // pick tail. Counted by phase, not position, so either axis order works.
    // The total never drops below the ordinal, so "第 23 问 · 共约 22 问"
    // cannot appear and the gauge never saturates early.
    const copingAnswered = this.phases.filter((p) => p === 'observe').length
    const copingDone = copingAnswered > 0 && phase !== 'observe'
    const copingEst = copingDone ? copingAnswered : Math.max(COPING_EST, copingAnswered + 1)
    const total = Math.max(
      this.pkg.originBlocks.blocks.length + copingEst + PICKS_EST,
      ordinal,
    )
    const resonance = Math.min(0.995, Math.max(0, progressed) / total)
    return { phase, answered, ordinal, total, resonance }
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
    const dg = r.diagnostics
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
        redirected: r.redirectedCell !== undefined,
        variantIndex: r.variantIndex,
        tier: r.tier,
        answersHash: r.answersHash,
        // origin axis
        originFamily: r.family,
        originRunnerUp: r.top2[1] ?? null,
        originSums: nonZero(dg?.originSums ?? {}),
        originMostCounts: nonZero(dg?.originMostCounts ?? {}),
        // coping axis
        copingStyle: r.style,
        copingStance: r.trueStance,
        copingConfidence: r.confidence,
        copingRunnerUp: r.runnerUp,
        copingCoreTally: dg?.coreTally ?? {},
        stanceVotes: dg?.stanceVotes ?? {},
        enteredBlock: dg?.enteredBlock ?? null,
        shadowStance: dg?.shadowStance ?? null,
        tiebreak: dg?.tieResolver
          ? {
              qid: dg.tieResolver.qid,
              voted: dg.tieResolver.voted,
              abstained: dg.tieResolver.abstained ?? false,
            }
          : null,
        guard: dg?.guard
          ? { qid: dg.guard.qid, outcome: dg.guard.outcome, from: dg.guard.from, to: dg.guard.to }
          : null,
        // pick tail
        originPick: r.picks.o,
        copingPick: r.picks.c,
        originGroup: r.originGroup,
        flags: dg?.flags ?? [],
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
    this.steps.length = 0
    this.phases.length = 0
    this.witchName = snapshot.witchName
    this.recompute()
    for (const oid of snapshot.answers) {
      const q = this.view.question
      if (!q || !q.options.some((o) => o.id === oid)) break
      this.engine.answer(oid)
      this.log.push(oid)
      this.steps.push(q.pair ?? '')
      this.phases.push(q.phase)
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
