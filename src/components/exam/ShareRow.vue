<script setup lang="ts">
/*
 * Share row (design spec §3.5/§D). Two buttons: the image export and a
 * social split button — its face fires the locale's default network, the ▾
 * segment opens a dropdown of secondary networks. zh-CN leads with copy
 * (paste-based sharing) and renders it primary; every click fires an
 * aggregate beacon.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import {
  shareRowSpecFor,
  saveResultImage,
  copySummary,
  openIntent,
  type ShareCard,
  type ShareAction,
} from '../../lib/share'
import { shareClicked } from '../../lib/beacon'
import { t } from '../../i18n'
import type { Locale } from '../../i18n/config'

const props = defineProps<{
  locale: Locale
  card: ShareCard
  cardEl: HTMLElement | null
}>()
const T = (k: string) => t(props.locale, k)

const spec = shareRowSpecFor(props.locale)
const busy = ref(false)
const copied = ref(false)
const failed = ref(false)
const menuOpen = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const labelFor: Record<ShareAction, string> = {
  image: 'share.image',
  copy: 'share.copyShare',
  weibo: 'share.weibo',
  qq: 'share.qq',
  x: 'share.x',
  threads: 'share.threads',
  facebook: 'share.facebook',
  reddit: 'share.reddit',
  line: 'share.line',
}

async function run(action: ShareAction) {
  menuOpen.value = false
  shareClicked(action)
  try {
    busy.value = true
    failed.value = false
    if (action === 'image') {
      if (props.cardEl) await saveResultImage(props.cardEl, props.card)
    } else if (action === 'copy') {
      if (await copySummary(props.card)) {
        copied.value = true
        window.setTimeout(() => (copied.value = false), 1800)
      }
    } else {
      openIntent(action, props.card)
    }
  } catch (err) {
    // A capture that throws (html2canvas chokes on an unsupported CSS value,
    // say) must not fail mute — the visitor is left staring at a button that
    // did nothing. Name it, and leave the trace in the console for a report.
    console.error('[share] %s failed', action, err)
    failed.value = true
    window.setTimeout(() => (failed.value = false), 2600)
  } finally {
    busy.value = false
  }
}

function onDocPointer(e: Event) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) menuOpen.value = false
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') menuOpen.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onDocKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onDocKey)
})
</script>

<template>
  <div ref="rootEl" class="share-row" :lang="locale">
    <div
      class="share-row__social"
      :class="{ 'is-primary': spec.socialFirst }"
      :style="{ order: spec.socialFirst ? 0 : 1 }"
    >
      <button
        type="button"
        class="share-row__btn share-row__btn--face"
        :disabled="busy"
        @click="run(spec.social)"
      >
        {{ copied ? T('share.copied') : T(labelFor[spec.social]) }}
      </button>
      <button
        type="button"
        class="share-row__btn share-row__btn--toggle"
        :aria-label="T('share.more')"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        :disabled="busy"
        @click="menuOpen = !menuOpen"
      >
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true" fill="none">
          <path d="M1 1 L5 5 L9 1" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <div v-if="menuOpen" class="share-row__menu" role="menu">
        <button
          v-for="a in spec.more"
          :key="a"
          type="button"
          class="share-row__item"
          role="menuitem"
          @click="run(a)"
        >
          {{ T(labelFor[a]) }}
        </button>
      </div>
    </div>

    <button
      type="button"
      class="share-row__btn share-row__btn--image"
      :class="{ 'is-primary': !spec.socialFirst }"
      :style="{ order: spec.socialFirst ? 1 : 0 }"
      :disabled="busy"
      @click="run('image')"
    >
      {{ failed ? T('share.imageFailed') : T('share.image') }}
    </button>
  </div>
</template>

<style scoped>
.share-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem;
}
.share-row__social {
  position: relative;
  display: flex;
}
.share-row__btn {
  font-family: var(--font-instrument);
  font-size: 0.9rem;
  letter-spacing: 0.06em;
  color: var(--bone-dim);
  border: 1px solid var(--hairline-faint);
  padding: 0.55rem 1.4rem;
  transition: color 160ms, border-color 160ms, background 160ms;
}
.share-row__btn:hover {
  color: var(--verdict-gold);
  border-color: var(--hairline);
}
.share-row__btn--face {
  border-right-width: 0;
}
.share-row__btn--toggle {
  padding: 0.55rem 0.7rem;
  display: flex;
  align-items: center;
}
.is-primary .share-row__btn,
.share-row__btn.is-primary {
  color: var(--ink);
  background: linear-gradient(160deg, var(--verdict-gold-bright), var(--verdict-gold-deep));
  border-color: transparent;
}
.is-primary .share-row__btn--toggle {
  border-left: 1px solid color-mix(in srgb, var(--ink) 35%, transparent);
}
.is-primary .share-row__btn:hover,
.share-row__btn.is-primary:hover {
  filter: brightness(1.08);
}
.share-row__btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.share-row__menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  min-width: 100%;
  z-index: 20;
  display: flex;
  flex-direction: column;
  background: var(--ink);
  border: 1px solid var(--hairline-faint);
  padding: 0.25rem 0;
}
.share-row__item {
  font-family: var(--font-instrument);
  font-size: 0.88rem;
  letter-spacing: 0.06em;
  color: var(--bone-dim);
  text-align: left;
  white-space: nowrap;
  padding: 0.5rem 1.1rem;
  transition: color 160ms, background 160ms;
}
.share-row__item:hover {
  color: var(--verdict-gold);
  background: color-mix(in srgb, var(--bone) 6%, transparent);
}
</style>
