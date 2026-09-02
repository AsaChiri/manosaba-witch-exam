<script setup lang="ts">
/*
 * The instrument (design spec §3.3). Dark plum ground, ember instrument
 * accents. Header = case no. + screen ordinal against the estimated total +
 * the 魔女因子 gauge (canon term). Scenario in body serif; options as
 * bone-on-velvet cards with an ember hover glow. One SCREEN per question —
 * an origin most/least pair shares one screen: the list stays in place, the
 * prompt flips, the most-pick shows as marked and inert (owner decision
 * 2026-09-02: 36 engine questions read as 22 screens).
 */
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import type { ExamQuestion, ExamProgress } from '../../lib/engine-api'
import { t } from '../../i18n'
import type { Locale } from '../../i18n/config'

const props = defineProps<{
  locale: Locale
  question: ExamQuestion
  progress: ExamProgress
  /** Per-run case number (flavour; drawn once per run, stable across reloads). */
  caseNo: string
}>()
const emit = defineEmits<{ answer: [optionId: string]; back: [] }>()
const T = (k: string, p?: Record<string, string | number>) => t(props.locale, k, p)

const SEGMENTS = 12
const filled = computed(() => Math.max(1, Math.round(props.progress.resonance * SEGMENTS)))

/** Screen key: a most/least pair keeps one key so the list does not slide. */
const screenKey = computed(() => props.question.blockId ?? props.question.id)
const isLeastStep = computed(() => props.question.pair === 'least')

/* Reading anchor for the long bank options: nearly every option opens with a
 * head phrase before a ——; rendering that head a weight up makes a 7-option
 * screen scannable. Presentation only — the label text is untouched. */
function optHead(label: string): string | null {
  const i = label.indexOf('——')
  return i > 0 && i <= 40 ? label.slice(0, i) : null
}
function optRest(label: string): string {
  const i = label.indexOf('——')
  return i > 0 && i <= 40 ? label.slice(i) : label
}

/* Overflow affordance: on phones the 7-option router screens run past the
 * fold with nothing hinting at options 6–7. A fixed bottom fade + chevron
 * shows while more of the list lies below the viewport. */
const overflow = ref(false)
function checkOverflow() {
  const el = document.scrollingElement ?? document.documentElement
  overflow.value = el.scrollHeight - (window.scrollY + window.innerHeight) > 32
}
onMounted(() => {
  window.addEventListener('scroll', checkOverflow, { passive: true })
  window.addEventListener('resize', checkOverflow)
  checkOverflow()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', checkOverflow)
  window.removeEventListener('resize', checkOverflow)
})
// A new screen starts at the top; the least step keeps the reader's place.
watch(screenKey, () => {
  window.scrollTo({ top: 0 })
  void nextTick(checkOverflow)
})
watch(() => props.question.id, () => void nextTick(checkOverflow))
</script>

<template>
  <section class="quiz" :lang="locale">
    <header class="quiz__head">
      <div class="quiz__meta">
        <span class="quiz__case">{{ T('exam.caseNoLabel') }} No.{{ caseNo }}</span>
        <span class="quiz__ord">{{ T('exam.questionOfTotal', { n: progress.ordinal, total: progress.total }) }}</span>
      </div>

      <div class="quiz__gauge" :aria-label="T('exam.resonance')">
        <span class="quiz__gauge-label">{{ T('exam.resonance') }}</span>
        <span class="quiz__gauge-bar">
          <span
            v-for="i in SEGMENTS"
            :key="i"
            class="quiz__seg"
            :class="{ 'is-on': i <= filled }"
          />
        </span>
      </div>
    </header>

    <Transition name="q-slide" mode="out-in">
      <div class="quiz__body" :class="{ 'is-least': isLeastStep }" :key="screenKey" :data-qid="question.id">
        <Transition name="q-flip" mode="out-in">
          <p class="quiz__prompt" :key="question.id">{{ question.prompt }}</p>
        </Transition>
        <ul class="quiz__options">
          <li v-for="opt in question.options" :key="opt.id">
            <button
              type="button"
              class="quiz__opt"
              :class="{ 'is-locked': opt.disabled }"
              :data-oid="opt.id"
              :disabled="opt.disabled"
              @click="opt.disabled ? undefined : emit('answer', opt.id)"
            >
              <span class="quiz__opt-mark" aria-hidden="true"></span>
              <span class="quiz__opt-body">
                <span v-if="opt.disabled" class="quiz__opt-lock">{{ T('exam.chosenAsMost') }}</span>
                <span class="quiz__opt-label">
                  <template v-if="optHead(opt.label)"
                    ><strong class="quiz__opt-head">{{ optHead(opt.label) }}</strong
                    >{{ optRest(opt.label) }}</template
                  >
                  <template v-else>{{ opt.label }}</template>
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </Transition>

    <footer class="quiz__foot">
      <button
        v-if="question.canGoBack"
        type="button"
        class="quiz__back"
        @click="emit('back')"
      >
        ← {{ T('exam.back') }}
      </button>
    </footer>

    <div class="quiz__more" :class="{ 'is-on': overflow }" aria-hidden="true">
      <span class="quiz__more-chevron">▾</span>
    </div>
  </section>
</template>

<style scoped>
.quiz {
  flex: 1;
  width: min(44rem, 100%);
  margin-inline: auto;
  padding: clamp(1.6rem, 5vh, 3rem) 1.2rem 3rem;
  display: flex;
  flex-direction: column;
}
.quiz__head {
  border: 1px solid color-mix(in srgb, var(--exam-ember) 22%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--exam-ember) 6%, transparent), transparent),
    color-mix(in srgb, var(--velvet) 76%, transparent);
  padding: 1rem 1.2rem;
  box-shadow: inset 0 0 30px color-mix(in srgb, var(--exam-ember) 8%, transparent);
}
.quiz__meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-family: var(--font-instrument);
  font-size: 0.86rem;
  letter-spacing: 0.08em;
  color: var(--exam-ember);
}
.quiz__ord {
  color: color-mix(in srgb, var(--exam-ember) 75%, var(--bone));
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.quiz__gauge {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.quiz__gauge-label {
  font-family: var(--font-instrument);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  color: var(--bone-faint);
  text-transform: uppercase;
}
.quiz__gauge-bar {
  display: flex;
  gap: 3px;
  flex: 1;
}
.quiz__seg {
  flex: 1;
  height: 8px;
  background: color-mix(in srgb, var(--bone) 10%, transparent);
  transition: background 260ms var(--ease-ceremony);
}
.quiz__seg.is-on {
  background: var(--exam-ember);
  box-shadow: 0 0 8px color-mix(in srgb, var(--exam-ember) 60%, transparent);
}

.quiz__body {
  margin-top: 2.2rem;
  flex: 1;
}
.quiz__prompt {
  font-family: var(--font-body);
  font-size: clamp(1.25rem, 4.2vw, 1.6rem);
  line-height: 1.55;
  color: var(--bone);
  margin-bottom: 1.8rem;
  text-wrap: pretty;
}
.quiz__options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.quiz__opt {
  width: 100%;
  display: flex;
  /* anchor to the first line — centered diamonds floated mid-paragraph on
   * multi-line options and gave the eye no row start to scan down */
  align-items: flex-start;
  gap: 0.9rem;
  text-align: left;
  padding: 1.05rem 1.2rem;
  background: color-mix(in srgb, var(--velvet-raised) 82%, transparent);
  border: 1px solid var(--panel-border);
  color: var(--bone);
  font-family: var(--font-body);
  font-size: 1.05rem;
  line-height: 1.5;
  transition:
    border-color 180ms,
    background 180ms,
    transform 180ms var(--ease-ceremony),
    box-shadow 180ms;
}
.quiz__opt-mark {
  flex: none;
  width: 10px;
  height: 10px;
  margin-top: 0.42em; /* optically centers the diamond on the first text line */
  transform: rotate(45deg);
  border: 1px solid color-mix(in srgb, var(--exam-ember) 60%, transparent);
  transition: background 180ms, box-shadow 180ms;
}
/* label column: the lock caption stacks ABOVE the text, never beside it — a
 * side-by-side caption squeezed the locked line into a half-width column */
.quiz__opt-body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
}
.quiz__opt:not(:disabled):hover,
.quiz__opt:not(:disabled):focus-visible {
  border-color: color-mix(in srgb, var(--exam-ember) 55%, transparent);
  background: color-mix(in srgb, var(--exam-ember) 8%, var(--velvet-raised));
  transform: translateX(3px);
  box-shadow: -3px 0 0 0 var(--exam-ember), 0 0 26px -6px color-mix(in srgb, var(--exam-ember) 40%, transparent);
  outline: none;
}
.quiz__opt:not(:disabled):hover .quiz__opt-mark,
.quiz__opt:not(:disabled):focus-visible .quiz__opt-mark {
  background: var(--exam-ember);
  box-shadow: 0 0 10px color-mix(in srgb, var(--exam-ember) 70%, transparent);
}

/* The locked line = the pick you already marked "most" on this screen. Kept in
   place, marked as chosen, inert (you cannot pick it least as well). */
.quiz__opt.is-locked {
  cursor: not-allowed;
  opacity: 0.62;
  background: color-mix(in srgb, var(--exam-ember) 5%, var(--velvet-raised));
  border-style: dashed;
  border-color: color-mix(in srgb, var(--exam-ember) 35%, transparent);
}
.quiz__opt.is-locked .quiz__opt-mark {
  transform: rotate(45deg) scale(0.9);
  border-color: var(--exam-ember);
  background: color-mix(in srgb, var(--exam-ember) 70%, transparent);
  box-shadow: none;
}
.quiz__opt-head {
  font-weight: 600;
  color: color-mix(in srgb, var(--bone) 88%, #fff);
}
.quiz__opt-lock {
  font-family: var(--font-instrument);
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--exam-ember);
}

.quiz__foot {
  margin-top: 1.8rem;
  min-height: 1.5rem;
}
.quiz__back {
  font-family: var(--font-instrument);
  font-size: 0.9rem;
  letter-spacing: 0.06em;
  color: var(--bone-faint);
  transition: color 160ms;
}
.quiz__back:hover {
  color: var(--exam-ember);
}

/* more-below affordance */
.quiz__more {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 5.5rem;
  z-index: 5;
  pointer-events: none;
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--ink) 92%, transparent) 70%);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 0.7rem;
  opacity: 0;
  transition: opacity 240ms var(--ease-ceremony);
}
.quiz__more.is-on {
  opacity: 1;
}
.quiz__more-chevron {
  font-family: var(--font-instrument);
  color: var(--exam-ember);
  font-size: 1.1rem;
  opacity: 0.8;
  animation: more-bob 1.6s ease-in-out infinite;
}
@keyframes more-bob {
  50% { transform: translateY(3px); }
}
@media (prefers-reduced-motion: reduce) {
  .quiz__more-chevron { animation: none; }
}

/* phones: denser rows so a 7-option screen shows more of the list at once */
@media (max-width: 420px) {
  .quiz { padding-top: 1.2rem; }
  .quiz__head { padding: 0.8rem 1rem; }
  .quiz__body { margin-top: 1.6rem; }
  .quiz__prompt { font-size: 1.2rem; margin-bottom: 1.3rem; }
  .quiz__options { gap: 0.6rem; }
  .quiz__opt { padding: 0.8rem 0.9rem; gap: 0.7rem; font-size: 0.98rem; line-height: 1.45; }
}

.q-slide-enter-active,
.q-slide-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}
.q-slide-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.q-slide-leave-to {
  opacity: 0;
  transform: translateX(-18px);
}
/* most → least: only the prompt changes, the list holds still */
.q-flip-enter-active,
.q-flip-leave-active {
  transition: opacity 160ms ease;
}
.q-flip-enter-from,
.q-flip-leave-to {
  opacity: 0;
}
</style>
