<script setup lang="ts">
/*
 * The Examination island (design spec §3.2). Hosts the whole flow behind a
 * single client:only mount: consent gate → quiz runner → witch-name prompt →
 * verdict sequence → result. Owns the engine session, persistence, beacon,
 * and — per the §5 delivery contract (2026-07-16) — the on-demand fetch of the
 * ONE resolved card (and character record) from /data/: the page ships no
 * corpus prose, so the exam payload stays O(1) as the corpus grows.
 */
import { ref, shallowRef, computed, watch, onMounted, type ShallowRef } from 'vue'
import { createExam } from '../../lib/engine'
import type {
  ExamSession,
  ExamQuestion,
  ExamProgress,
  ExamResult,
} from '../../lib/engine-api'
import {
  hasConsent,
  setConsent,
  saveProgress,
  loadProgress,
  clearProgress,
  getFinished,
  setFinished,
} from '../../lib/storage'
import { recordCollected, recordCharacter } from '../../lib/collection'
import { examStart, questionAnswered, resultLanded } from '../../lib/beacon'
import {
  fetchCardAsset,
  fetchCharacterAsset,
  type AssetOutcome,
} from '../../lib/card-fetch'
import { sanitizeWitchName } from '../../lib/sanitize'
import { localePath, type Locale } from '../../i18n/config'
import { t } from '../../i18n'
import type { Card, WitchCharacter } from '../../lib/content-types'
import ConsentGate from './ConsentGate.vue'
import QuizRunner from './QuizRunner.vue'
import SpoilerGate from './SpoilerGate.vue'
import NamePrompt from './NamePrompt.vue'
import VerdictSequence from './VerdictSequence.vue'
import ResultView from './ResultView.vue'

const props = defineProps<{
  locale: Locale
  quizVersion: string
  /** Progress-storage invalidation hash (contentVersion~quizVersion). */
  contentHash: string
  /** /data/ asset cache-buster — prose-sensitive, unlike contentHash. */
  assetsVersion: string
  /** Character trigger map: result tag → {id, magicName} ({} = feature off).
   *  magicName keeps the verdict teaser fetch-independent; the record's PROSE
   *  is fetched from /data/ only on an actual exact-hit trigger (§3.7). */
  characterHits: Record<string, { id: string; magicName: string }>
}>()

type State =
  | 'loading'
  | 'consent'
  | 'quiz'
  | 'spoiler'
  | 'name'
  | 'verdict'
  | 'retrieving'
  | 'result'
  | 'inconclusive'
const state = ref<State>('loading')
const session = shallowRef<ExamSession | null>(null)
const question = shallowRef<ExamQuestion | null>(null)
const progress = ref<ExamProgress | null>(null)
const result = shallowRef<ExamResult | null>(null)
// the spoiler gate's answer, mirrored from storage (design spec §3.7)
const finished = ref(false)

/* ── /data/ asset state (design spec §5 delivery contract) ──
 * 'absent' = HTTP 404, a SEMANTIC outcome (no card exists at this tag), routed
 * to the graceful no-record screen; 'error' = network-class failure after the
 * fetch layer's silent retry, routed to the manual-retry surface. */
type FetchPhase<T> =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'hit'; data: T }
  | { phase: 'absent' }
  | { phase: 'error' }
const cardFetch = shallowRef<FetchPhase<Card>>({ phase: 'idle' })
const charFetch = shallowRef<FetchPhase<WitchCharacter>>({ phase: 'idle' })
/** True once a settle failed — flips the retrieving screen to the retry UI. */
const retrieveFailed = ref(false)
/** Bumped on retake so in-flight fetch settles from the old run are orphaned. */
let fetchSeq = 0
/** Whether the verdict animation already played (a later hit skips to result). */
const verdictPlayed = ref(false)

function track<T>(
  target: ShallowRef<FetchPhase<T>>,
  make: () => Promise<AssetOutcome<T>>,
): void {
  const seq = fetchSeq
  target.value = { phase: 'pending' }
  make().then(
    (o) => {
      if (seq !== fetchSeq) return
      target.value = o.kind === 'hit' ? { phase: 'hit', data: o.data } : { phase: 'absent' }
    },
    () => {
      if (seq !== fetchSeq) return
      target.value = { phase: 'error' }
    },
  )
}

/** Resolves when the fetch leaves 'pending' (immediately if it already has). */
function settled<T>(target: ShallowRef<FetchPhase<T>>): Promise<void> {
  if (target.value.phase !== 'pending') return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch(target, (v) => {
      if (v.phase !== 'pending') {
        stop()
        resolve()
      }
    })
  })
}

function newSession(): ExamSession {
  const s = createExam({
    locale: props.locale,
    quizVersion: props.quizVersion,
  })
  session.value = s
  return s
}

function refresh() {
  const s = session.value
  if (!s) return
  question.value = s.current()
  progress.value = s.progress()
}

/** Pure tag peek on a done session — result() is idempotent and independent
 *  of the (not yet entered) witch name, so prefetching from it is safe. */
function peekResult(s: ExamSession): ExamResult | null {
  if (!s.isDone() || s.isInconclusive?.()) return null
  return s.result()
}

function isExactHit(r: ExamResult): boolean {
  return !!r.debug && r.debug.resolvedCell === r.debug.landedCell
}

/** Fire the card fetch (and the character fetch when the gate is already
 *  affirmed) the moment the quiz completes — the spoiler-gate + name-prompt
 *  dwell hides the latency, and the verdict teaser reads the card reactively. */
function startPrefetch(s: ExamSession): void {
  const r = peekResult(s)
  if (!r) return
  if (cardFetch.value.phase === 'idle') {
    track(cardFetch, () => fetchCardAsset(props.locale, r.tag, props.assetsVersion))
  }
  const hit = props.characterHits[r.tag]
  if (hit && isExactHit(r) && getFinished() === 'yes' && charFetch.value.phase === 'idle') {
    track(charFetch, () => fetchCharacterAsset(props.locale, hit.id, props.assetsVersion))
  }
}

function onConsent() {
  setConsent(true)
  examStart()
  const s = newSession()
  refresh()
  state.value = 'quiz'
  void s
}

function onDecline() {
  window.location.href = localePath(props.locale, '/')
}

function doneState(s: ExamSession): State {
  return s.isInconclusive?.() ? 'inconclusive' : 'name'
}

/* After the last scored question: the spoiler gate (§3.7) — unless the visitor
 * already answered "yes" once (finishing the game is irreversible), or the exam
 * is inconclusive (no result → no card → nothing to gate). */
function nextAfterQuiz(s: ExamSession): State {
  const d = doneState(s)
  return d === 'name' && getFinished() !== 'yes' ? 'spoiler' : d
}

function onAnswer(optionId: string) {
  const s = session.value
  if (!s) return
  const idx = s.progress().answered
  s.answer(optionId)
  questionAnswered(idx)
  saveProgress(s.snapshot(), props.contentHash)
  if (s.isDone()) {
    startPrefetch(s)
    state.value = nextAfterQuiz(s)
  } else refresh()
}

function onSpoilerAnswer(answeredFinished: boolean) {
  setFinished(answeredFinished)
  finished.value = answeredFinished
  // "yes" just now — the exact-hit character prefetch was locked until here.
  const s = session.value
  if (answeredFinished && s) {
    const r = peekResult(s)
    const hit = r ? props.characterHits[r.tag] : undefined
    if (r && hit && isExactHit(r) && charFetch.value.phase === 'idle') {
      track(charFetch, () => fetchCharacterAsset(props.locale, hit.id, props.assetsVersion))
    }
  }
  state.value = 'name'
}

function onBack() {
  const s = session.value
  if (!s) return
  s.back()
  saveProgress(s.snapshot(), props.contentHash)
  refresh()
}

/* After the name: resolve → beacon → settle the needed asset → verdict.
 * The special path enters the verdict immediately (existence is map-known and
 * the teaser is map-supplied; the prose settles under the animation). The
 * normal path settles the card FIRST: a 404 must land on the graceful
 * no-record screen — 「検出」 followed by "no record" would be a miscue. */
async function onName(name: string) {
  const s = session.value
  if (!s) return
  const clean = sanitizeWitchName(name)
  s.setWitchName(clean || undefined)
  const r = s.result()
  result.value = r
  if (!r) {
    state.value = 'inconclusive'
    return
  }
  resultLanded(r.cell, r.tag)
  const hit = specialHit.value
  if (hit) {
    recordCharacter(hit.id)
    if (charFetch.value.phase === 'idle' || charFetch.value.phase === 'error') {
      retrieveFailed.value = false
      track(charFetch, () => fetchCharacterAsset(props.locale, hit.id, props.assetsVersion))
    }
    state.value = 'verdict'
    return
  }
  await settleCard(r)
}

/** Settle the card fetch and branch; a hit lands on the verdict (or straight
 *  on the result once the animation has already played). */
async function settleCard(r: ExamResult): Promise<void> {
  if (cardFetch.value.phase === 'idle' || cardFetch.value.phase === 'error') {
    retrieveFailed.value = false
    track(cardFetch, () => fetchCardAsset(props.locale, r.tag, props.assetsVersion))
  }
  const seq = fetchSeq
  if (cardFetch.value.phase === 'pending') {
    state.value = 'retrieving'
    await settled(cardFetch)
    if (seq !== fetchSeq) return
  }
  const c = cardFetch.value
  if (c.phase === 'hit') {
    recordCollected(r.tag)
    state.value = verdictPlayed.value ? 'result' : 'verdict'
  } else if (c.phase === 'absent') {
    // No card exists at this tag (character-only cell reached without the
    // gate, or an unshipped tag): graceful no-record, never a failure UI.
    state.value = 'inconclusive'
  } else {
    retrieveFailed.value = true
    state.value = 'retrieving'
  }
}

async function onVerdictDone() {
  verdictPlayed.value = true
  const hit = specialHit.value
  if (!hit) {
    state.value = 'result'
    return
  }
  // Special path: the prose may still be in flight (the animation was cover).
  const seq = fetchSeq
  if (charFetch.value.phase === 'pending') {
    state.value = 'retrieving'
    await settled(charFetch)
    if (seq !== fetchSeq) return
  }
  const c = charFetch.value
  if (c.phase === 'hit') {
    state.value = 'result'
  } else if (c.phase === 'absent') {
    // Deploy skew — the map names a character whose asset is gone. Fall back
    // to the normal-card outcome for the same tag.
    const r = result.value
    if (r) await settleCard(r)
    else state.value = 'inconclusive'
  } else {
    retrieveFailed.value = true
    state.value = 'retrieving'
  }
}

/** Manual retry from the failed retrieving screen. */
async function onRetryFetch() {
  const r = result.value
  if (!r) return
  retrieveFailed.value = false
  const hit = specialHit.value
  if (hit && charFetch.value.phase !== 'hit') {
    if (charFetch.value.phase === 'idle' || charFetch.value.phase === 'error') {
      track(charFetch, () => fetchCharacterAsset(props.locale, hit.id, props.assetsVersion))
    }
    const seq = fetchSeq
    state.value = 'retrieving'
    await settled(charFetch)
    if (seq !== fetchSeq) return
    const c = charFetch.value
    if (c.phase === 'hit') state.value = verdictPlayed.value ? 'result' : 'verdict'
    else if (c.phase === 'absent') await settleCard(r)
    else {
      retrieveFailed.value = true
      state.value = 'retrieving'
    }
    return
  }
  await settleCard(r)
}

function onRetake() {
  clearProgress()
  fetchSeq++
  cardFetch.value = { phase: 'idle' }
  charFetch.value = { phase: 'idle' }
  retrieveFailed.value = false
  verdictPlayed.value = false
  newSession()
  refresh()
  result.value = null
  state.value = 'quiz'
}

const resolvedCard = computed<Card | null>(() =>
  cardFetch.value.phase === 'hit' ? cardFetch.value.data : null,
)

/* The special character record replaces the normal card ONLY on an exact hit
 * (user decision 2026-07-15): the visitor affirmed the spoiler gate AND the
 * exam resolved to the character's own tag with no cell redirect. Trigger
 * data is the synchronous characterHits map; the mock engine carries no debug
 * block, so it never triggers. The record's prose arrives via charFetch. */
const specialHit = computed<{ id: string; magicName: string } | null>(() => {
  const r = result.value
  if (!r || !finished.value) return null
  const hit = props.characterHits[r.tag]
  if (!hit) return null
  if (!isExactHit(r)) return null
  return hit
})
const specialCharacter = computed<WitchCharacter | null>(() =>
  specialHit.value && charFetch.value.phase === 'hit' ? charFetch.value.data : null,
)

onMounted(() => {
  finished.value = getFinished() === 'yes'
  if (hasConsent()) {
    const s = newSession()
    const snap = loadProgress(props.contentHash)
    if (snap) s.restore(snap)
    refresh()
    if (s.isDone()) {
      startPrefetch(s)
      state.value = nextAfterQuiz(s)
    } else {
      state.value = 'quiz'
    }
  } else {
    state.value = 'consent'
  }
})
</script>

<template>
  <div class="exam-island">
    <div v-if="state === 'loading'" class="exam-island__boot">
      <span class="exam-island__boot-text">{{ t(locale, 'exam.booting') }}<span class="exam-island__cursor">▊</span></span>
    </div>
    <ConsentGate
      v-else-if="state === 'consent'"
      :locale="locale"
      @consent="onConsent"
      @decline="onDecline"
    />
    <QuizRunner
      v-else-if="state === 'quiz' && question && progress"
      :locale="locale"
      :question="question"
      :progress="progress"
      @answer="onAnswer"
      @back="onBack"
    />
    <SpoilerGate v-else-if="state === 'spoiler'" :locale="locale" @answer="onSpoilerAnswer" />
    <NamePrompt v-else-if="state === 'name'" :locale="locale" @submit="onName" />
    <VerdictSequence
      v-else-if="state === 'verdict' && result"
      :locale="locale"
      :result="result"
      :card="resolvedCard"
      :teaser-override="specialHit?.magicName ?? null"
      @done="onVerdictDone"
    />
    <ResultView
      v-else-if="state === 'result' && result && (resolvedCard || specialCharacter)"
      :locale="locale"
      :card="specialCharacter ? null : resolvedCard"
      :result="result"
      :quiz-version="quizVersion"
      :content-hash="contentHash"
      :special-character="specialCharacter"
      @retake="onRetake"
    />
    <section
      v-else-if="state === 'retrieving'"
      class="exam-island__retrieving"
      :lang="locale"
    >
      <div v-if="!retrieveFailed" class="exam-island__boot exam-island__boot--inline">
        <span class="exam-island__boot-text">{{ t(locale, 'exam.retrieving') }}<span class="exam-island__cursor">▊</span></span>
      </div>
      <div v-else class="exam-island__inc-panel">
        <p class="exam-island__inc-body">{{ t(locale, 'exam.fetchError') }}</p>
        <button type="button" class="exam-island__inc-retake" @click="onRetryFetch">
          {{ t(locale, 'exam.fetchRetry') }}
        </button>
      </div>
    </section>
    <section v-else-if="state === 'inconclusive'" class="exam-island__inconclusive" :lang="locale">
      <div class="exam-island__inc-panel">
        <p class="exam-island__inc-title">{{ t(locale, 'exam.inconclusive.title') }}</p>
        <p class="exam-island__inc-body">{{ t(locale, 'exam.inconclusive.body') }}</p>
        <button type="button" class="exam-island__inc-retake" @click="onRetake">
          {{ t(locale, 'card.retake') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.exam-island {
  min-height: 100svh;
  display: flex;
  flex-direction: column;
}
.exam-island__boot {
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 100svh;
}
.exam-island__boot--inline {
  min-height: 0;
}
.exam-island__boot-text {
  font-family: var(--font-instrument);
  color: var(--exam-cyan);
  letter-spacing: 0.16em;
  font-size: 0.95rem;
  opacity: 0.8;
}
.exam-island__cursor {
  animation: blink 0.5s steps(1) infinite;
}
@keyframes blink {
  50% { opacity: 0; }
}
.exam-island__retrieving,
.exam-island__inconclusive {
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 100svh;
  padding: 2rem 1.2rem;
}
.exam-island__inc-panel {
  width: min(34rem, 100%);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.exam-island__inc-title {
  font-family: var(--font-inscription);
  font-weight: 600;
  font-size: clamp(1.4rem, 5vw, 1.9rem);
  color: var(--bone);
  letter-spacing: 0.06em;
}
.exam-island__inc-body {
  font-family: var(--font-body);
  color: var(--bone-dim);
  line-height: 1.7;
  text-wrap: pretty;
}
.exam-island__inc-retake {
  margin-top: 0.6rem;
  align-self: center;
  font-family: var(--font-instrument);
  font-size: 0.92rem;
  letter-spacing: 0.06em;
  color: var(--verdict-gold-deep);
  text-decoration: underline;
  text-underline-offset: 0.2em;
  text-decoration-color: var(--hairline-faint);
}
.exam-island__inc-retake:hover {
  color: var(--verdict-gold);
}
</style>
