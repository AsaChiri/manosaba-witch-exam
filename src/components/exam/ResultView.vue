<script setup lang="ts">
/*
 * Result (design spec §3.5) — the 魔女図鑑 entry the examination resolved to,
 * in the shared witch-card markup (so the PNG matches the card page), plus the
 * share row, feedback, safety footer, retake, and the soft-launch archival line.
 */
import { ref, computed, onMounted } from 'vue'
import type { ExamResult } from '../../lib/engine-api'
import type { Card } from '../../lib/content-schema'
import { t, messages } from '../../i18n'
import type { Locale } from '../../i18n/config'
import { generateShareQr, copyText, type ShareCard } from '../../lib/share'
import Seal from './Seal.vue'
import ShareRow from './ShareRow.vue'

const props = defineProps<{
  locale: Locale
  card: Card
  result: ExamResult
  quizVersion: string
  phase: 'soft' | 'launch'
}>()
const emit = defineEmits<{ retake: [] }>()
const T = (k: string, p?: Record<string, string | number>) => t(props.locale, k, p)
const L = (k: string) => t(props.locale, `card.labels.${k}`)

const witchName = computed(
  () => props.result.witchName?.trim() || t(props.locale, 'card.nameless'),
)
const shareCard = computed<ShareCard>(() => ({
  locale: props.locale,
  tag: props.card.tag,
  name: witchName.value,
  epithet: props.card.epithet,
}))

const frameEl = ref<HTMLElement | null>(null)
const qrSrc = ref('')
const corners = ['tl', 'tr', 'bl', 'br'] as const

// Feedback (inline — Astro components can't render into the island).
const email = import.meta.env.PUBLIC_FEEDBACK_EMAIL || 'feedback@example.invalid'
const mailto = computed(() => {
  const subject = T('feedback.mailSubject', {
    tag: props.card.tag,
    quiz: props.quizVersion,
    locale: props.locale,
  })
  const body = T('feedback.mailBody')
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
})
const emailCopied = ref(false)
async function copyEmail() {
  if (await copyText(email)) {
    emailCopied.value = true
    window.setTimeout(() => (emailCopied.value = false), 1800)
  }
}

const crisis = messages(props.locale).crisisLinks

onMounted(async () => {
  try {
    qrSrc.value = await generateShareQr(shareCard.value)
  } catch {
    /* QR is a nicety; ignore failures */
  }
})
</script>

<template>
  <section class="result" :lang="locale">
    <p v-if="phase === 'soft'" class="result__archival">{{ T('feedback.softArchival') }}</p>

    <div class="result__stage">
      <div ref="frameEl" class="card-frame">
        <div class="card-frame__rule">
          <svg
            v-for="c in corners"
            :key="c"
            :class="`card-frame__fleuron card-frame__fleuron--${c}`"
            width="52"
            height="52"
            viewBox="0 0 52 52"
            aria-hidden="true"
            fill="none"
          >
            <path d="M3 49 L3 15 Q3 3 15 3 L49 3" stroke="currentColor" stroke-width="1.1" opacity="0.9" />
            <path d="M9 49 L9 17 Q9 9 17 9 L49 9" stroke="currentColor" stroke-width="0.6" opacity="0.45" />
            <path d="M15 33 C15 23, 23 15, 33 15" stroke="currentColor" stroke-width="0.8" opacity="0.8" />
            <path d="M15 33 C19 27, 21 25, 20 20 M15 33 C21 29, 23 31, 28 30" stroke="currentColor" stroke-width="0.7" opacity="0.7" />
            <circle cx="16" cy="16" r="1.7" fill="currentColor" opacity="0.85" />
          </svg>
          <div class="card-frame__inner">
            <article class="witch-card">
              <div class="witch-card__crest"><Seal :size="72" stained :title="T('meta.siteName')" /></div>
              <p class="witch-card__specimen">
                <span class="witch-card__specimen-label">{{ T('card.specimenLabel') }}</span>
                &nbsp;·&nbsp;{{ witchName }}
              </p>
              <p class="witch-card__cell">{{ card.cell.label }}</p>
              <div class="witch-card__epithet-block">
                <span class="witch-card__epithet-label">{{ L('epithet') }}</span>
                <h2 class="witch-card__epithet">{{ card.epithet }}</h2>
              </div>
              <hr class="witch-card__divider" />
              <section class="witch-card__field">
                <span class="witch-card__field-label">{{ L('magic') }}</span>
                <p class="witch-card__field-body">
                  <span v-if="card.magic.name" class="witch-card__magic-name">{{ card.magic.name }}　</span>{{ card.magic.text }}
                </p>
              </section>
              <section class="witch-card__field">
                <span class="witch-card__field-label">{{ L('crime') }}</span>
                <ul class="witch-card__list">
                  <li v-for="(line, i) in card.crime" :key="i">{{ line }}</li>
                </ul>
              </section>
              <section class="witch-card__field">
                <span class="witch-card__field-label">{{ L('execution') }}</span>
                <ul class="witch-card__list">
                  <li v-for="(line, i) in card.execution" :key="i">{{ line }}</li>
                </ul>
              </section>
              <section class="witch-card__field" style="text-align:center">
                <span class="witch-card__field-label">{{ L('epitaph') }}</span>
                <p class="witch-card__epitaph">{{ card.epitaph }}</p>
              </section>

              <div class="witch-card__export-footer">
                <div class="witch-card__export-brand">
                  <div class="brand">{{ T('share.exportTag') }}</div>
                  <div class="cap">{{ T('share.qrCaption') }}</div>
                </div>
                <img v-if="qrSrc" class="witch-card__export-qr" :src="qrSrc" alt="" />
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>

    <div class="result__actions">
      <ShareRow :locale="locale" :card="shareCard" :card-el="frameEl" />
      <button type="button" class="result__retake" @click="emit('retake')">
        {{ T('card.retake') }}
      </button>
    </div>

    <div class="result__feedback" :class="{ 'is-prominent': phase === 'soft' }">
      <p class="result__invite">{{ T('feedback.invite') }}</p>
      <div class="result__fb-row">
        <a class="result__fb-write" :href="mailto">{{ T('feedback.emailLabel') }}</a>
        <code class="result__fb-addr">{{ email }}</code>
        <button type="button" class="result__fb-copy" @click="copyEmail">
          {{ emailCopied ? T('feedback.copied') : T('feedback.copyEmail') }}
        </button>
      </div>
    </div>

    <aside class="result__safety">
      <p class="result__safety-line">{{ T('result.safety') }}</p>
      <details>
        <summary>{{ T('result.safetyLink') }}</summary>
        <ul>
          <li v-for="c in crisis" :key="c.region + c.name">
            <span class="rg">{{ c.region }}</span>
            <span class="nm">{{ c.name }}</span>
            <span class="dt">{{ c.detail }}</span>
          </li>
        </ul>
      </details>
    </aside>
  </section>
</template>

<style scoped>
.result {
  flex: 1;
  width: min(46rem, 100%);
  margin-inline: auto;
  padding: clamp(1.6rem, 5vh, 3rem) 1.2rem 4rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  animation: rise-fade 500ms var(--ease-ceremony) both;
}
.result__archival {
  text-align: center;
  font-family: var(--font-body);
  font-style: italic;
  color: var(--witch-violet);
  letter-spacing: 0.02em;
}
.result__stage {
  max-width: 36rem;
  width: 100%;
  margin-inline: auto;
}
.result__actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.1rem;
}
.result__retake {
  font-family: var(--font-instrument);
  font-size: 0.9rem;
  letter-spacing: 0.06em;
  color: var(--bone-faint);
  text-decoration: underline;
  text-underline-offset: 0.2em;
  text-decoration-color: var(--hairline-faint);
}
.result__retake:hover {
  color: var(--witch-violet);
}

.result__feedback {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.result__feedback.is-prominent {
  padding: 1.4rem 1.5rem;
  border: 1px solid var(--hairline-faint);
  background: color-mix(in srgb, var(--velvet) 70%, transparent);
}
.result__invite {
  color: var(--bone-dim);
}
.result__fb-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.result__fb-write {
  font-family: var(--font-instrument);
  letter-spacing: 0.08em;
  color: var(--verdict-gold);
  text-decoration: none;
  border-bottom: 1px solid var(--hairline);
  padding-bottom: 1px;
}
.result__fb-addr {
  font-family: var(--font-instrument);
  font-size: 0.86rem;
  color: var(--bone-dim);
  user-select: all;
  word-break: break-all;
}
.result__fb-copy {
  font-family: var(--font-instrument);
  font-size: 0.78rem;
  color: var(--bone-faint);
  border: 1px solid var(--hairline-faint);
  padding: 0.2rem 0.6rem;
}
.result__fb-copy:hover {
  color: var(--bone);
  border-color: var(--hairline);
}

.result__safety {
  color: var(--bone-faint);
  font-size: 0.86rem;
  line-height: 1.7;
  border-top: 1px solid var(--hairline-faint);
  padding-top: 1.4rem;
}
.result__safety-line {
  color: var(--bone-dim);
}
.result__safety details {
  margin-top: 0.5rem;
}
.result__safety summary {
  cursor: pointer;
  color: var(--verdict-gold-deep);
  font-family: var(--font-instrument);
  letter-spacing: 0.06em;
}
.result__safety summary:hover {
  color: var(--verdict-gold);
}
.result__safety ul {
  margin: 0.7rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.result__safety li {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  align-items: baseline;
}
.result__safety .rg {
  color: var(--bone-faint);
  min-width: 5em;
}
.result__safety .nm {
  color: var(--bone-dim);
}
.result__safety .dt {
  font-family: var(--font-instrument);
  color: var(--verdict-gold-deep);
}
</style>
