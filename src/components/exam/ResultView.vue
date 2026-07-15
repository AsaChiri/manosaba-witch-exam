<script setup lang="ts">
/*
 * Result (design spec §3.5) — the 魔女図鑑 entry the examination resolved to,
 * in the shared witch-card markup (so the PNG matches the card page), plus the
 * share row, feedback invitation, safety footer, and retake.
 */
import { ref, computed, onMounted, watch } from 'vue'
import type { ExamResult } from '../../lib/engine-api'
import { cardTitle, type Card, type WitchCharacter } from '../../lib/content-schema'
import { CONTENT_HASH } from '../../lib/content'
import { t, messages } from '../../i18n'
import { localePath, type Locale } from '../../i18n/config'
import { generateShareQr, copyText, type ShareCard } from '../../lib/share'
import Seal from './Seal.vue'
import ShareRow from './ShareRow.vue'
import SpecialCard from './SpecialCard.vue'

const props = defineProps<{
  locale: Locale
  card: Card
  result: ExamResult
  quizVersion: string
  /** Exact-hit special character record (§3.7) — replaces the witch card. */
  specialCharacter?: WitchCharacter | null
}>()
const emit = defineEmits<{ retake: [] }>()
const T = (k: string, p?: Record<string, string | number>) => t(props.locale, k, p)
const L = (k: string) => t(props.locale, `card.labels.${k}`)

const witchName = computed(
  () => props.result.witchName?.trim() || t(props.locale, 'card.nameless'),
)
/* With a special character, the share surface pivots to the character record:
 * template/URL/QR/filename all follow ShareCard.character (see share.ts). */
const shareCard = computed<ShareCard>(() => {
  const sc = props.specialCharacter
  if (sc) {
    return {
      locale: props.locale,
      tag: props.card.tag,
      name: witchName.value,
      magic: sc.magicName,
      magicText: `${sc.awakening.before} ${sc.awakening.after}`,
      character: { id: sc.id, name: sc.name },
    }
  }
  return {
    locale: props.locale,
    tag: props.card.tag,
    name: witchName.value,
    magic: props.card.magic.name,
    magicText: props.card.magic.text,
  }
})

const frameEl = ref<HTMLElement | null>(null)
const qrSrc = ref('')
/* The corner offsets live on the wrapping <span> and the flip inside the SVG —
 * never on the <svg> element itself, which html2canvas would carry into the
 * exported PNG's rasterization and paint out of frame (see witch-card.css).
 * Keep in sync with CardFrame.astro. */
const corners = [
  { c: 'tl', flip: '' },
  { c: 'tr', flip: 'translate(52 0) scale(-1 1)' },
  { c: 'bl', flip: 'translate(0 52) scale(1 -1)' },
  { c: 'br', flip: 'translate(52 52) scale(-1 -1)' },
] as const

// Feedback (inline — Astro components can't render into the island).
const email = import.meta.env.PUBLIC_FEEDBACK_EMAIL || 'witch-exam-feedback@asachiri.com'

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')

/**
 * Prefilled body: the visitor's free note, then an out-of-world technical block
 * that lets us reproduce the routing (design spec §6) — card shown, resolved
 * cell (pre-redirect → served), variant, version, and the raw answer sequence.
 * The answers are the replay key; the note beside them says they may be deleted.
 */
function feedbackBody(): string {
  const d = props.result.debug
  const lines = [T('feedback.mailBody'), '', T('feedback.debugHeader')]
  lines.push(`${T('feedback.debugCard')}: ${props.card.tag}`)
  if (d) {
    const route =
      d.resolvedCell === d.landedCell ? d.resolvedCell : `${d.resolvedCell} → ${d.landedCell}`
    lines.push(`${T('feedback.debugRouting')}: ${route} · v${d.variantIndex} · #${hex(d.answersHash)}`)
  }
  lines.push(`${T('feedback.debugVersion')}: ${props.locale} / q${props.quizVersion} / ${CONTENT_HASH}`)
  if (d?.answers.length) {
    lines.push('', T('feedback.debugAnswersNote'), `${T('feedback.debugAnswers')}: ${d.answers.join(' ')}`)
  }
  return lines.join('\n')
}

const mailto = computed(() => {
  const subject = T('feedback.mailSubject', {
    tag: props.card.tag,
    quiz: props.quizVersion,
    locale: props.locale,
  })
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(feedbackBody())}`
})
const emailCopied = ref(false)
async function copyEmail() {
  if (await copyText(email)) {
    emailCopied.value = true
    window.setTimeout(() => (emailCopied.value = false), 1800)
  }
}

const crisis = messages(props.locale).crisisLinks

async function refreshQr() {
  try {
    qrSrc.value = await generateShareQr(shareCard.value)
  } catch {
    /* QR is a nicety; ignore failures */
  }
}
onMounted(refreshQr)
// the share target changes when the special character record swaps in/out
watch(() => props.specialCharacter, refreshQr)
</script>

<template>
  <section class="result" :lang="locale">
    <div class="result__stage">
      <div
        ref="frameEl"
        class="card-frame"
        :class="{ 'card-frame--character': specialCharacter }"
        :style="specialCharacter ? { '--frame-tone': specialCharacter.color } : undefined"
      >
        <div class="card-frame__rule">
          <span
            v-for="corner in corners"
            :key="corner.c"
            :class="`card-frame__fleuron card-frame__fleuron--${corner.c}`"
            aria-hidden="true"
          >
            <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
              <g :transform="corner.flip">
                <path d="M3 49 L3 15 Q3 3 15 3 L49 3" stroke="currentColor" stroke-width="1.1" opacity="0.9" />
                <path d="M9 49 L9 17 Q9 9 17 9 L49 9" stroke="currentColor" stroke-width="0.6" opacity="0.45" />
                <path d="M15 33 C15 23, 23 15, 33 15" stroke="currentColor" stroke-width="0.8" opacity="0.8" />
                <path d="M15 33 C19 27, 21 25, 20 20 M15 33 C21 29, 23 31, 28 30" stroke="currentColor" stroke-width="0.7" opacity="0.7" />
                <circle cx="16" cy="16" r="1.7" fill="currentColor" opacity="0.85" />
              </g>
            </svg>
          </span>
          <div class="card-frame__inner">
            <SpecialCard
              v-if="specialCharacter"
              :locale="locale"
              :character="specialCharacter"
              :witch-name="witchName"
              :qr-src="qrSrc"
            />
            <article v-else class="witch-card">
              <div class="witch-card__crest"><Seal :size="72" stained :title="T('meta.siteName')" /></div>
              <p class="witch-card__specimen">
                <span class="witch-card__specimen-label">{{ T('card.specimenLabel') }}</span>
                &nbsp;·&nbsp;{{ witchName }}
              </p>
              <div class="witch-card__epithet-block">
                <span class="witch-card__magic-mark">
                  <svg class="witch-card__mark-orn" width="46" height="7" viewBox="0 0 46 7" aria-hidden="true"><path d="M0 3.5 H36" stroke="currentColor" stroke-width="0.8" opacity="0.65"/><rect x="38" y="1.4" width="4.2" height="4.2" transform="rotate(45 40.1 3.5)" fill="currentColor"/></svg>
                  {{ T('card.magicMark') }}
                  <svg class="witch-card__mark-orn witch-card__mark-orn--flip" width="46" height="7" viewBox="0 0 46 7" aria-hidden="true"><path d="M0 3.5 H36" stroke="currentColor" stroke-width="0.8" opacity="0.65"/><rect x="38" y="1.4" width="4.2" height="4.2" transform="rotate(45 40.1 3.5)" fill="currentColor"/></svg>
                </span>
                <h2 class="witch-card__epithet">{{ cardTitle(card) }}</h2>
                <p class="witch-card__magic-lead">{{ card.magic.text }}</p>
              </div>
              <hr class="witch-card__divider" />
              <section class="witch-card__field">
                <span class="witch-card__field-label">{{ L('epithet') }}</span>
                <p class="witch-card__field-body">{{ card.epithet }}</p>
              </section>
              <section class="witch-card__field">
                <span class="witch-card__field-label">{{ L('crime') }}</span>
                <div class="witch-card__prose">
                  <p v-for="(line, i) in card.crime" :key="i">{{ line }}</p>
                </div>
              </section>
              <section class="witch-card__field">
                <span class="witch-card__field-label">{{ L('execution') }}</span>
                <div class="witch-card__prose">
                  <p v-for="(line, i) in card.execution" :key="i">{{ line }}</p>
                </div>
              </section>
              <section class="witch-card__field" style="text-align:center">
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
      <div class="result__links">
        <button type="button" class="result__retake" @click="emit('retake')">
          {{ T('card.retake') }}
        </button>
        <span class="result__links-dot" aria-hidden="true">·</span>
        <a class="result__retake" :href="localePath(locale, '/collection/')">
          {{ T('collection.link') }}
        </a>
      </div>
    </div>

    <div class="result__feedback">
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
.result__links {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
  justify-content: center;
}
a.result__retake {
  text-decoration-line: underline;
}
.result__links-dot {
  color: var(--hairline-faint);
  font-family: var(--font-instrument);
}

.result__feedback {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
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
