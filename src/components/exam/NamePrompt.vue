<script setup lang="ts">
/*
 * Witch-name prompt (design spec §3.3) — 「記録に刻む名」. Optional; sanitized;
 * capped at 20. The instrument's final registration step before the verdict.
 */
import { ref, computed } from 'vue'
import { t } from '../../i18n'
import { WITCH_NAME_MAX } from '../../lib/sanitize'
import type { Locale } from '../../i18n/config'

const props = defineProps<{ locale: Locale }>()
const emit = defineEmits<{ submit: [name: string] }>()
const T = (k: string) => t(props.locale, k)

const value = ref('')
const remaining = computed(() => WITCH_NAME_MAX - Array.from(value.value).length)

function confirm() {
  emit('submit', value.value)
}
function skip() {
  emit('submit', '')
}
</script>

<template>
  <section class="name" :lang="locale">
    <div class="name__panel">
      <p class="name__eyebrow">{{ T('exam.namePrompt.eyebrow') }}</p>
      <h1 class="name__title">{{ T('exam.namePrompt.title') }}</h1>

      <form class="name__form" @submit.prevent="confirm">
        <input
          class="name__input"
          type="text"
          :maxlength="WITCH_NAME_MAX"
          :placeholder="T('exam.namePrompt.placeholder')"
          v-model="value"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          aria-label="witch name"
        />
        <div class="name__meta">
          <span class="name__hint">{{ T('exam.namePrompt.hint') }}</span>
          <span class="name__count">{{ remaining }}</span>
        </div>

        <div class="name__actions">
          <button type="submit" class="name__confirm">{{ T('exam.namePrompt.confirm') }}</button>
          <button type="button" class="name__skip" @click="skip">
            {{ T('exam.namePrompt.skip') }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.name {
  flex: 1;
  display: grid;
  place-items: center;
  padding: clamp(1.6rem, 8vh, 4rem) 1.2rem;
}
.name__panel {
  width: min(34rem, 100%);
  text-align: center;
}
.name__eyebrow {
  font-family: var(--font-instrument);
  letter-spacing: 0.26em;
  font-size: 0.78rem;
  color: var(--exam-cyan);
  text-transform: uppercase;
}
.name__title {
  font-family: var(--font-inscription);
  font-weight: 600;
  font-size: clamp(1.6rem, 5.6vw, 2.2rem);
  color: var(--bone);
  letter-spacing: 0.08em;
  margin: 0.8rem 0 2rem;
}
.name__form {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.name__input {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--exam-cyan) 45%, transparent);
  color: var(--bone);
  font-family: var(--font-inscription);
  font-size: clamp(1.4rem, 5vw, 1.9rem);
  text-align: center;
  letter-spacing: 0.08em;
  padding: 0.6rem 0.4rem;
  transition: border-color 180ms;
}
.name__input::placeholder {
  color: var(--bone-faint);
  font-family: var(--font-body);
  font-style: italic;
}
.name__input:focus {
  outline: none;
  border-bottom-color: var(--exam-cyan);
  box-shadow: 0 6px 18px -12px var(--exam-cyan);
}
.name__meta {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-instrument);
  font-size: 0.8rem;
  color: var(--bone-faint);
}
.name__actions {
  margin-top: 1.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.4rem;
  flex-wrap: wrap;
}
.name__confirm {
  font-family: var(--font-inscription);
  font-weight: 600;
  font-size: 1.02rem;
  letter-spacing: 0.06em;
  color: var(--ink);
  background: linear-gradient(160deg, var(--verdict-gold-bright), var(--verdict-gold-deep));
  padding: 0.8rem 1.9rem;
  box-shadow: 0 10px 24px -12px var(--verdict-gold);
  transition: transform 160ms var(--ease-ceremony), filter 160ms;
}
.name__confirm:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
.name__skip {
  font-family: var(--font-body);
  color: var(--bone-dim);
  text-decoration: underline;
  text-underline-offset: 0.2em;
  text-decoration-color: var(--hairline-faint);
}
.name__skip:hover {
  color: var(--bone);
}
</style>
