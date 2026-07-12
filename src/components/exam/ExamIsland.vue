<script setup lang="ts">
/*
 * The Examination island (design spec §3.2). Hosts the whole flow behind a
 * single client:only mount: consent gate → quiz runner → witch-name prompt →
 * verdict sequence → result. Owns the engine session, persistence, and beacon.
 */
import { ref, shallowRef, computed, onMounted } from 'vue'
import { createExam } from '../../lib/engine'
import type {
  ExamSession,
  ExamQuestion,
  ExamProgress,
  ExamResult,
  CellCandidate,
} from '../../lib/engine-api'
import {
  hasConsent,
  setConsent,
  saveProgress,
  loadProgress,
  clearProgress,
} from '../../lib/storage'
import { recordCollected } from '../../lib/collection'
import { examStart, questionAnswered, resultLanded } from '../../lib/beacon'
import { sanitizeWitchName } from '../../lib/sanitize'
import { localePath, type Locale } from '../../i18n/config'
import { t } from '../../i18n'
import type { Card } from '../../lib/content-schema'
import ConsentGate from './ConsentGate.vue'
import QuizRunner from './QuizRunner.vue'
import NamePrompt from './NamePrompt.vue'
import VerdictSequence from './VerdictSequence.vue'
import ResultView from './ResultView.vue'

const props = defineProps<{
  locale: Locale
  quizVersion: string
  cells: CellCandidate[]
  cards: Record<string, Card>
}>()

type State = 'loading' | 'consent' | 'quiz' | 'name' | 'verdict' | 'result' | 'inconclusive'
const state = ref<State>('loading')
const session = shallowRef<ExamSession | null>(null)
const question = shallowRef<ExamQuestion | null>(null)
const progress = ref<ExamProgress | null>(null)
const result = shallowRef<ExamResult | null>(null)

function newSession(): ExamSession {
  const s = createExam({
    locale: props.locale,
    quizVersion: props.quizVersion,
    cells: props.cells,
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

function onAnswer(optionId: string) {
  const s = session.value
  if (!s) return
  const idx = s.progress().answered
  s.answer(optionId)
  questionAnswered(idx)
  saveProgress(s.snapshot())
  if (s.isDone()) state.value = doneState(s)
  else refresh()
}

function onBack() {
  const s = session.value
  if (!s) return
  s.back()
  saveProgress(s.snapshot())
  refresh()
}

function onName(name: string) {
  const s = session.value
  if (!s) return
  const clean = sanitizeWitchName(name)
  s.setWitchName(clean || undefined)
  const r = s.result()
  result.value = r
  if (r) {
    resultLanded(r.cell, r.tag)
    recordCollected(r.tag) // accumulate across retakes (the archive)
  }
  state.value = 'verdict'
}

function onVerdictDone() {
  state.value = 'result'
}

function onRetake() {
  clearProgress()
  newSession()
  refresh()
  result.value = null
  state.value = 'quiz'
}

const resolvedCard = computed<Card | null>(() =>
  result.value ? (props.cards[result.value.tag] ?? null) : null,
)

onMounted(() => {
  if (hasConsent()) {
    const s = newSession()
    const snap = loadProgress()
    if (snap) s.restore(snap)
    refresh()
    state.value = s.isDone() ? doneState(s) : 'quiz'
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
    <NamePrompt v-else-if="state === 'name'" :locale="locale" @submit="onName" />
    <VerdictSequence
      v-else-if="state === 'verdict' && result"
      :locale="locale"
      :result="result"
      :card="resolvedCard"
      @done="onVerdictDone"
    />
    <ResultView
      v-else-if="state === 'result' && result && resolvedCard"
      :locale="locale"
      :card="resolvedCard"
      :result="result"
      :quiz-version="quizVersion"
      @retake="onRetake"
    />
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
