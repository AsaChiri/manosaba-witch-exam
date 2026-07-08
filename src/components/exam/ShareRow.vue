<script setup lang="ts">
/*
 * Share row (design spec §3.5/§D). Locale-gated channels; Save captures the
 * card element as a PNG; Copy copies the summary; social channels open intent
 * URLs; every click fires an aggregate beacon.
 */
import { ref } from 'vue'
import {
  shareChannelsFor,
  saveResultImage,
  copySummary,
  shareToWeibo,
  shareToQQ,
  shareToX,
  webShare,
  type ShareCard,
  type ShareChannel,
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

const channels = shareChannelsFor(props.locale)
const busy = ref<ShareChannel | null>(null)
const copied = ref(false)

const labelFor: Record<ShareChannel, string> = {
  save: 'share.save',
  copy: 'share.copyLink',
  weibo: 'share.weibo',
  qq: 'share.qq',
  x: 'share.x',
  webshare: 'share.webshare',
}

async function run(channel: ShareChannel) {
  shareClicked(channel)
  try {
    busy.value = channel
    switch (channel) {
      case 'save':
        if (props.cardEl) await saveResultImage(props.cardEl, props.card)
        break
      case 'copy': {
        const ok = await copySummary(props.card)
        if (ok) {
          copied.value = true
          window.setTimeout(() => (copied.value = false), 1800)
        }
        break
      }
      case 'weibo':
        shareToWeibo(props.card)
        break
      case 'qq':
        shareToQQ(props.card)
        break
      case 'x':
        shareToX(props.card)
        break
      case 'webshare':
        await webShare(props.card)
        break
    }
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="share-row" :lang="locale">
    <button
      v-for="ch in channels"
      :key="ch"
      type="button"
      class="share-row__btn"
      :class="{ 'is-busy': busy === ch, 'is-primary': ch === 'save' }"
      :disabled="busy !== null"
      @click="run(ch)"
    >
      {{ ch === 'copy' && copied ? T('share.copied') : T(labelFor[ch]) }}
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
.share-row__btn {
  font-family: var(--font-instrument);
  font-size: 0.9rem;
  letter-spacing: 0.06em;
  color: var(--bone-dim);
  border: 1px solid var(--hairline-faint);
  padding: 0.55rem 1.1rem;
  transition: color 160ms, border-color 160ms, background 160ms;
}
.share-row__btn:hover {
  color: var(--verdict-gold);
  border-color: var(--hairline);
}
.share-row__btn.is-primary {
  color: var(--ink);
  background: linear-gradient(160deg, var(--verdict-gold-bright), var(--verdict-gold-deep));
  border-color: transparent;
}
.share-row__btn.is-primary:hover {
  filter: brightness(1.08);
}
.share-row__btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
