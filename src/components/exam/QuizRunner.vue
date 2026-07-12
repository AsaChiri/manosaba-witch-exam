<script setup lang="ts">
/*
 * The instrument (design spec §3.3). Dark plum ground, cyan instrument accents.
 * Header = case no. + question ordinal + the 魔女因子 gauge (canon term; never
 * a percent, never invented phase names). Scenario in body serif; options as
 * bone-on-velvet cards with a cyan hover glow. One question per screen.
 */
import { computed } from 'vue'
import type { ExamQuestion, ExamProgress } from '../../lib/engine-api'
import { t } from '../../i18n'
import type { Locale } from '../../i18n/config'

const props = defineProps<{
  locale: Locale
  question: ExamQuestion
  progress: ExamProgress
}>()
const emit = defineEmits<{ answer: [optionId: string]; back: [] }>()
const T = (k: string, p?: Record<string, string | number>) => t(props.locale, k, p)

// Stable-per-session specimen code (flavour only).
const specimenCode = `${100 + Math.floor(Math.random() * 900)}-${'ABCD'[Math.floor(Math.random() * 4)]}`

const SEGMENTS = 12
const filled = computed(() => Math.max(1, Math.round(props.progress.resonance * SEGMENTS)))
</script>

<template>
  <section class="quiz" :lang="locale">
    <header class="quiz__head">
      <div class="quiz__meta">
        <span class="quiz__case">{{ T('exam.caseNoLabel') }} No.{{ specimenCode }}</span>
        <span class="quiz__ord">{{ T('exam.questionOrdinal', { n: progress.ordinal }) }}</span>
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
      <div class="quiz__body" :key="question.id" :data-qid="question.id">
        <p class="quiz__prompt">{{ question.prompt }}</p>
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
              <span class="quiz__opt-label">{{ opt.label }}</span>
              <span v-if="opt.disabled" class="quiz__opt-lock">{{ T('exam.chosenAsMost') }}</span>
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
  border: 1px solid color-mix(in srgb, var(--exam-cyan) 22%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--exam-cyan) 6%, transparent), transparent),
    color-mix(in srgb, var(--velvet) 76%, transparent);
  padding: 1rem 1.2rem;
  box-shadow: inset 0 0 30px color-mix(in srgb, var(--exam-cyan) 8%, transparent);
}
.quiz__meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-family: var(--font-instrument);
  font-size: 0.86rem;
  letter-spacing: 0.08em;
  color: var(--exam-cyan);
}
.quiz__ord {
  color: color-mix(in srgb, var(--exam-cyan) 75%, var(--bone));
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
  background: var(--exam-cyan);
  box-shadow: 0 0 8px color-mix(in srgb, var(--exam-cyan) 60%, transparent);
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
  align-items: center;
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
  transform: rotate(45deg);
  border: 1px solid color-mix(in srgb, var(--exam-cyan) 60%, transparent);
  transition: background 180ms, box-shadow 180ms;
}
.quiz__opt:not(:disabled):hover,
.quiz__opt:not(:disabled):focus-visible {
  border-color: color-mix(in srgb, var(--exam-cyan) 55%, transparent);
  background: color-mix(in srgb, var(--exam-cyan) 8%, var(--velvet-raised));
  transform: translateX(3px);
  box-shadow: -3px 0 0 0 var(--exam-cyan), 0 0 26px -6px color-mix(in srgb, var(--exam-cyan) 40%, transparent);
  outline: none;
}
.quiz__opt:not(:disabled):hover .quiz__opt-mark,
.quiz__opt:not(:disabled):focus-visible .quiz__opt-mark {
  background: var(--exam-cyan);
  box-shadow: 0 0 10px color-mix(in srgb, var(--exam-cyan) 70%, transparent);
}

/* The locked line = the pick you already marked "most" on this block. Shown so
   the screen keeps all four lines, dimmed and inert (you cannot pick it least). */
.quiz__opt.is-locked {
  cursor: not-allowed;
  opacity: 0.5;
  background: color-mix(in srgb, var(--velvet-raised) 55%, transparent);
  border-style: dashed;
  border-color: var(--hairline-faint);
}
.quiz__opt.is-locked .quiz__opt-mark {
  transform: rotate(45deg) scale(0.85);
  border-color: var(--hairline-faint);
  background: color-mix(in srgb, var(--bone) 25%, transparent);
  box-shadow: none;
}
.quiz__opt-lock {
  margin-left: auto;
  flex: none;
  font-family: var(--font-instrument);
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--bone-faint);
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
  color: var(--exam-cyan);
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
</style>
