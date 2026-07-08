<script setup lang="ts">
/*
 * Consent to Examination (design spec §3.2) — a parchment page with torn
 * edges (the one light surface in the site), instrument-pixel headers, ink
 * text. Plain-language 18+ / content notice / crisis links / storage note.
 * Two actions: consent / decline (no dark pattern).
 */
import { t, messages } from '../../i18n'
import type { Locale } from '../../i18n/config'

const props = defineProps<{ locale: Locale }>()
const emit = defineEmits<{ consent: []; decline: [] }>()
const crisis = messages(props.locale).crisisLinks
const T = (k: string) => t(props.locale, k)
</script>

<template>
  <section class="gate" :lang="locale">
    <div class="gate__doc torn-edge">
      <p class="gate__eyebrow">{{ T('gate.eyebrow') }}</p>
      <h1 class="gate__title">{{ T('gate.title') }}</h1>

      <div class="gate__body">
        <p>{{ T('gate.fan') }}</p>
        <p class="gate__warn">{{ T('gate.age') }}</p>
        <p class="gate__note">{{ T('gate.fictional') }}</p>
        <p>{{ T('gate.content') }}</p>

        <div class="gate__crisis">
          <p>{{ T('gate.crisisIntro') }}</p>
          <ul>
            <li v-for="c in crisis" :key="c.region + c.name">
              <span class="gate__region">{{ c.region }}</span>
              <span class="gate__cname">{{ c.name }}</span>
              <span class="gate__cdetail">{{ c.detail }}</span>
            </li>
          </ul>
        </div>

        <p class="gate__storage">{{ T('gate.storage') }}</p>
      </div>

      <div class="gate__actions">
        <button type="button" class="gate__consent" @click="emit('consent')">
          {{ T('gate.consent') }}
        </button>
        <button type="button" class="gate__decline" @click="emit('decline')">
          {{ T('gate.decline') }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gate {
  flex: 1;
  display: grid;
  place-items: center;
  padding: clamp(1.4rem, 6vh, 4rem) 1.1rem;
}
.gate__doc {
  position: relative;
  width: min(38rem, 100%);
  background:
    radial-gradient(120% 90% at 30% 0%, color-mix(in srgb, #fff 22%, var(--parchment)), transparent 60%),
    linear-gradient(160deg, var(--parchment) 0%, var(--parchment-dim) 100%);
  color: var(--parchment-ink);
  padding: clamp(2rem, 6vw, 3.2rem) clamp(1.6rem, 5vw, 2.8rem);
  box-shadow:
    0 30px 70px -30px rgba(0, 0, 0, 0.9),
    inset 0 0 60px rgba(120, 86, 60, 0.14);
}
.gate__eyebrow {
  font-family: var(--font-instrument);
  letter-spacing: 0.28em;
  font-size: 0.8rem;
  color: var(--verdict-gold-deep);
  text-transform: uppercase;
}
.gate__title {
  font-family: var(--font-inscription);
  font-weight: 700;
  font-size: clamp(1.6rem, 5.4vw, 2.2rem);
  color: #2a1c15;
  letter-spacing: 0.06em;
  margin: 0.5rem 0 1.4rem;
  border-bottom: 1px solid rgba(90, 60, 40, 0.3);
  padding-bottom: 1rem;
}
.gate__body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  font-family: var(--font-body);
  font-size: 1.02rem;
  line-height: 1.75;
  color: var(--parchment-ink);
}
/* Formal content descriptor (game-disclaimer register): measured, not shouty. */
.gate__warn {
  font-weight: 500;
  color: #5a2a24;
  font-size: 0.96rem;
  line-height: 1.7;
}
.gate__note {
  font-size: 0.9rem;
  color: #5c4636;
}
.gate__crisis {
  border-left: 3px solid rgba(120, 40, 30, 0.5);
  padding-left: 1rem;
}
.gate__crisis ul {
  margin: 0.6rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.gate__crisis li {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  align-items: baseline;
  font-size: 0.94rem;
}
.gate__region {
  min-width: 4.5em;
  color: #7a5a3c;
}
.gate__cname {
  font-weight: 600;
}
.gate__cdetail {
  font-family: var(--font-instrument);
  color: #6d1520;
  letter-spacing: 0.03em;
}
.gate__storage {
  font-size: 0.9rem;
  color: #5c4636;
}
.gate__actions {
  margin-top: 1.8rem;
  display: flex;
  align-items: center;
  gap: 1.2rem;
  flex-wrap: wrap;
}
.gate__consent {
  font-family: var(--font-inscription);
  font-weight: 600;
  font-size: 1.02rem;
  letter-spacing: 0.06em;
  color: #fdeede;
  background: linear-gradient(160deg, var(--crimson), var(--oxblood));
  padding: 0.85rem 1.8rem;
  border: 1px solid rgba(40, 8, 12, 0.4);
  box-shadow: 0 8px 20px -8px rgba(92, 15, 26, 0.7);
  transition: transform 160ms var(--ease-ceremony), filter 160ms;
}
.gate__consent:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
.gate__decline {
  font-family: var(--font-body);
  font-size: 0.98rem;
  color: #6b5344;
  text-decoration: underline;
  text-decoration-color: rgba(90, 60, 40, 0.4);
  text-underline-offset: 0.2em;
}
.gate__decline:hover {
  color: #3a2a1e;
}
.gate__consent:focus-visible,
.gate__decline:focus-visible {
  outline: 2px solid var(--oxblood);
  outline-offset: 3px;
}
</style>
