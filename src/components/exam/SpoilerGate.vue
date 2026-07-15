<script setup lang="ts">
/*
 * The spoiler gate (design spec §3.7) — one extra, unscored question rendered
 * in the examination's own question idiom, so it reads as the exam's last
 * question. Diegetic stem (the story on the island) + a parenthetical plain
 * explanation; two equal-weight options, no nudging. The answer never reaches
 * the engine: the island stores it under its own localStorage key.
 *
 * Prompt/option styling is kept in sync with QuizRunner.vue (scoped styles
 * cannot be shared across components — same pattern as the card frame markup).
 */
import { t } from '../../i18n'
import type { Locale } from '../../i18n/config'

const props = defineProps<{ locale: Locale }>()
const emit = defineEmits<{ answer: [finished: boolean] }>()
const T = (k: string) => t(props.locale, k)
</script>

<template>
  <section class="spoiler" :lang="locale">
    <div class="spoiler__body">
      <p class="spoiler__prompt">{{ T('exam.spoiler.question') }}</p>
      <p class="spoiler__note">{{ T('exam.spoiler.note') }}</p>
      <ul class="spoiler__options">
        <li>
          <button type="button" class="spoiler__opt" data-oid="spoiler-yes" @click="emit('answer', true)">
            <span class="spoiler__opt-mark" aria-hidden="true"></span>
            <span class="spoiler__opt-label">{{ T('exam.spoiler.yes') }}</span>
          </button>
        </li>
        <li>
          <button type="button" class="spoiler__opt" data-oid="spoiler-no" @click="emit('answer', false)">
            <span class="spoiler__opt-mark" aria-hidden="true"></span>
            <span class="spoiler__opt-label">{{ T('exam.spoiler.no') }}</span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.spoiler {
  flex: 1;
  width: min(44rem, 100%);
  margin-inline: auto;
  padding: clamp(1.6rem, 5vh, 3rem) 1.2rem 3rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  animation: rise-fade 400ms var(--ease-ceremony) both;
}
.spoiler__prompt {
  font-family: var(--font-body);
  font-size: clamp(1.25rem, 4.2vw, 1.6rem);
  line-height: 1.55;
  color: var(--bone);
  text-wrap: pretty;
}
.spoiler__note {
  margin-top: 0.9rem;
  margin-bottom: 1.8rem;
  font-family: var(--font-body);
  font-size: 0.92rem;
  line-height: 1.65;
  color: var(--bone-faint);
  text-wrap: pretty;
}
.spoiler__options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
/* keep in sync with QuizRunner.vue .quiz__opt */
.spoiler__opt {
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
.spoiler__opt-mark {
  flex: none;
  width: 10px;
  height: 10px;
  transform: rotate(45deg);
  border: 1px solid color-mix(in srgb, var(--exam-cyan) 60%, transparent);
  transition: background 180ms, box-shadow 180ms;
}
.spoiler__opt:hover,
.spoiler__opt:focus-visible {
  border-color: color-mix(in srgb, var(--exam-cyan) 55%, transparent);
  background: color-mix(in srgb, var(--exam-cyan) 8%, var(--velvet-raised));
  transform: translateX(3px);
  box-shadow: -3px 0 0 0 var(--exam-cyan), 0 0 26px -6px color-mix(in srgb, var(--exam-cyan) 40%, transparent);
  outline: none;
}
.spoiler__opt:hover .spoiler__opt-mark,
.spoiler__opt:focus-visible .spoiler__opt-mark {
  background: var(--exam-cyan);
  box-shadow: 0 0 10px color-mix(in srgb, var(--exam-cyan) 70%, transparent);
}
</style>
