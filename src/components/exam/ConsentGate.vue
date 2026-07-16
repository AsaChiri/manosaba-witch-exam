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
    <div class="gate__doc">
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
              <span class="gate__cline">
                <span class="gate__cname">{{ c.name }}</span>
                <span class="gate__cdetail">{{ c.detail }}</span>
              </span>
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
  /* Torn edges with FIXED tooth depth (px), unlike the %-depth .torn-edge
   * utility: on this tall document, %-deep teeth grew with page height and
   * swallowed the eyebrow and the consent button on mobile. Horizontal spread
   * stays in % so the tear scales with width; depth never exceeds 16px. */
  clip-path: polygon(
    0 14px, 4% 3px, 9% 15px, 15% 2px, 22% 12px, 29% 4px, 36% 16px, 44% 3px,
    52% 13px, 60% 2px, 68% 12px, 76% 3px, 84% 16px, 91% 5px, 96% 13px, 100% 6px,
    100% calc(100% - 12px), 96% calc(100% - 3px), 91% calc(100% - 14px),
    84% calc(100% - 2px), 76% calc(100% - 13px), 68% calc(100% - 4px),
    60% calc(100% - 16px), 52% calc(100% - 2px), 44% calc(100% - 12px),
    36% calc(100% - 3px), 29% calc(100% - 15px), 22% calc(100% - 4px),
    15% calc(100% - 13px), 9% calc(100% - 2px), 4% calc(100% - 12px),
    0 calc(100% - 5px)
  );
}
.gate__eyebrow {
  font-family: var(--font-instrument);
  letter-spacing: 0.28em;
  font-size: 0.8rem;
  /* stamp ink, not gold: gold-on-parchment sat below comfortable contrast */
  color: var(--logo-blood);
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
/* region | name+number as a two-column grid: when the number can't fit beside
 * a long name (mobile), it wraps UNDER the name, still aligned to the name
 * column — it used to orphan flush-left under the region. */
.gate__crisis li {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 0.9em;
  align-items: baseline;
  font-size: 0.94rem;
}
.gate__region {
  color: #7a5a3c;
}
.gate__cline {
  display: flex;
  flex-wrap: wrap;
  column-gap: 0.6em;
  align-items: baseline;
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
