<script setup lang="ts">
/*
 * The verdict reveal (design spec §2.4/§3.4) — the ONE orchestrated animation.
 * readout completes → cyan flatlines → violet bloom rises → the Seal stamps in
 * → 「魔女因子――検出。」 → sentence + magic-name teaser → unfold into the card.
 * Skippable on tap; prefers-reduced-motion gets a static cut.
 */
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { ExamResult } from '../../lib/engine-api'
import type { Card } from '../../lib/content-types'
import { t } from '../../i18n'
import type { Locale } from '../../i18n/config'
import Seal from './Seal.vue'

const props = defineProps<{
  locale: Locale
  result: ExamResult
  card: Card | null
  /** Special character record hit (§3.7): its magic name replaces the card's
   *  in the teaser, so the reveal matches the record that unfolds next. */
  teaserOverride?: string | null
}>()
const emit = defineEmits<{ done: [] }>()
const T = (k: string) => t(props.locale, k)

const reduced = ref(false)
let timer: number | undefined

function finish() {
  if (timer) window.clearTimeout(timer)
  emit('done')
}

onMounted(() => {
  reduced.value =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const total = reduced.value ? 1200 : 4400
  timer = window.setTimeout(finish, total)
})
onBeforeUnmount(() => {
  if (timer) window.clearTimeout(timer)
})
</script>

<template>
  <section
    class="verdict"
    :class="{ 'is-reduced': reduced }"
    :lang="locale"
    role="button"
    tabindex="0"
    :aria-label="T('verdict.skip')"
    @click="finish"
    @keydown.enter="finish"
    @keydown.space.prevent="finish"
  >
    <div class="verdict__bloom" aria-hidden="true"></div>
    <div class="verdict__stage">
      <p class="verdict__reading">{{ T('verdict.reading') }}<span class="verdict__cursor">▊</span></p>
      <div class="verdict__flat" aria-hidden="true"></div>

      <div class="verdict__seal"><Seal :size="150" glow :title="T('meta.siteName')" /></div>

      <h1 class="verdict__detected">{{ T('verdict.detected') }}</h1>
      <p class="verdict__sentence">{{ T('verdict.sentence') }}</p>
      <p v-if="card || teaserOverride" class="verdict__teaser">
        <span class="verdict__teaser-label">{{ T('verdict.teaser') }}</span>
        <span class="verdict__epithet">{{ teaserOverride ?? card?.magic.name }}</span>
      </p>
    </div>
    <button type="button" class="verdict__skip" @click.stop="finish">{{ T('verdict.skip') }} ›</button>
  </section>
</template>

<style scoped>
.verdict {
  flex: 1;
  position: relative;
  display: grid;
  place-items: center;
  min-height: 100svh;
  overflow: hidden;
  cursor: pointer;
  text-align: center;
  padding: 2rem 1.2rem;
}
.verdict__bloom {
  position: absolute;
  left: 50%;
  bottom: -30%;
  width: 140vmax;
  height: 140vmax;
  transform: translateX(-50%) scale(0.2);
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--witch-violet) 42%, transparent) 0%,
    color-mix(in srgb, var(--witch-violet-deep) 24%, transparent) 34%,
    transparent 62%
  );
  opacity: 0;
  animation: bloom-rise 2.6s var(--ease-ceremony) 1.1s forwards;
  pointer-events: none;
}
.verdict__stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 34rem;
}
.verdict__reading {
  font-family: var(--font-instrument);
  color: var(--exam-cyan);
  letter-spacing: 0.18em;
  font-size: 1rem;
  text-shadow: 0 0 12px color-mix(in srgb, var(--exam-cyan) 55%, transparent);
  animation: reading-fade 0.9s ease 0.7s forwards;
}
.verdict__cursor {
  animation: blink 0.5s steps(1) infinite;
}
.verdict__flat {
  width: min(22rem, 70vw);
  height: 2px;
  margin: 0.9rem 0 0;
  background: var(--exam-cyan);
  box-shadow: 0 0 14px var(--exam-cyan);
  transform-origin: center;
  animation: flatline 1.2s var(--ease-out-sharp) 0.7s forwards;
}
.verdict__seal {
  color: var(--verdict-gold);
  margin: 1.4rem 0 0.6rem;
  opacity: 0;
  transform: scale(1.7);
  animation: stamp 0.6s cubic-bezier(0.2, 1.5, 0.4, 1) 1.9s forwards;
  filter: drop-shadow(0 0 22px color-mix(in srgb, var(--verdict-gold) 40%, transparent));
}
.verdict__detected {
  font-family: var(--font-inscription);
  font-weight: 700;
  font-size: clamp(1.9rem, 7vw, 3rem);
  letter-spacing: 0.08em;
  color: var(--bone);
  margin-top: 1rem;
  opacity: 0;
  transform: translateY(10px);
  animation: rise 0.7s var(--ease-ceremony) 2.5s forwards;
  text-shadow: 0 0 26px color-mix(in srgb, var(--witch-violet) 30%, transparent);
}
.verdict__sentence {
  font-family: var(--font-body);
  font-style: var(--font-style-em);
  font-size: clamp(1rem, 3.2vw, 1.22rem);
  color: var(--witch-violet);
  margin-top: 1rem;
  opacity: 0;
  animation: rise 0.7s var(--ease-ceremony) 3s forwards;
}
.verdict__teaser {
  margin-top: 1.6rem;
  opacity: 0;
  animation: rise 0.7s var(--ease-ceremony) 3.4s forwards;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.verdict__teaser-label {
  font-family: var(--font-instrument);
  font-size: 0.8rem;
  letter-spacing: 0.2em;
  color: var(--verdict-gold-deep);
  text-transform: uppercase;
}
.verdict__epithet {
  font-family: var(--font-inscription);
  font-weight: 600;
  font-size: clamp(1.4rem, 5vw, 2rem);
  color: var(--witch-violet);
}
.verdict__skip {
  position: absolute;
  bottom: 1.6rem;
  right: 1.6rem;
  z-index: 2;
  font-family: var(--font-instrument);
  font-size: 0.86rem;
  letter-spacing: 0.1em;
  color: var(--bone-faint);
}
.verdict__skip:hover {
  color: var(--bone);
}

@keyframes reading-fade {
  to { opacity: 0.15; }
}
@keyframes blink {
  50% { opacity: 0; }
}
@keyframes flatline {
  0% { transform: scaleY(6); opacity: 1; }
  30% { transform: scaleY(1); }
  70% { transform: scaleY(1); opacity: 1; filter: none; }
  100% {
    transform: scaleY(0.5);
    opacity: 0;
    background: var(--witch-violet);
    box-shadow: 0 0 14px var(--witch-violet);
  }
}
@keyframes bloom-rise {
  0% { opacity: 0; transform: translateX(-50%) scale(0.2); }
  60% { opacity: 1; }
  100% { opacity: 0.9; transform: translateX(-50%) scale(1); }
}
@keyframes stamp {
  0% { opacity: 0; transform: scale(1.7); }
  60% { opacity: 1; transform: scale(0.94); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes rise {
  to { opacity: 1; transform: none; }
}

/* Reduced motion — static cut: everything already at final state. */
.is-reduced .verdict__bloom { animation: none; opacity: 0.85; transform: translateX(-50%) scale(1); }
.is-reduced .verdict__reading,
.is-reduced .verdict__flat { display: none; }
.is-reduced .verdict__seal { animation: none; opacity: 1; transform: none; }
.is-reduced .verdict__detected,
.is-reduced .verdict__sentence,
.is-reduced .verdict__teaser { animation: none; opacity: 1; transform: none; }
</style>
