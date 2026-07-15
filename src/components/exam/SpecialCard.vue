<script setup lang="ts">
/*
 * The special character record (design spec §3.7) — the inner card article,
 * rendered inside ResultView's card-frame when the exact-hit trigger fires.
 *
 * Concept: this is still the VISITOR's examination record — the same magic as
 * a canon prisoner was detected. So it mirrors the normal witch card's frame
 * of reference (名 = the visitor's given name, magic headline + description,
 * 原罪 field), but the crime/execution section gives way to the warden's
 * remark, and the record closes on the character's own artbook quote where
 * the epitaph would sit. Character-color visual identity throughout.
 * Keep the markup in sync with SpecialCard.astro (the /c/<id>/ share page).
 */
import { computed } from 'vue'
import type { WitchCharacter } from '../../lib/content-schema'
import { t } from '../../i18n'
import type { Locale } from '../../i18n/config'
import { roseWindowSvg, CHARACTER_MOTIFS } from '../../lib/rose-window'

const props = defineProps<{
  locale: Locale
  character: WitchCharacter
  /** The visitor's resolved witch name (name or the Nameless Witch). */
  witchName: string
  /** QR for the export footer (points at the /c/<id>/ share page). */
  qrSrc?: string
}>()
const T = (k: string, p?: Record<string, string | number>) => t(props.locale, k, p)

// Per-character warden remark when authored; else the generic template.
const wardenLine = computed(
  () =>
    props.character.warden ??
    T('result.specialCard.wardenLine', { name: props.character.name }),
)

// Her rose window (lib/rose-window.ts) — deterministic SVG string, safe for
// v-html (generated entirely from our own code + compiled content).
const windowSvg = computed(() =>
  roseWindowSvg({
    color: props.character.color,
    motif: CHARACTER_MOTIFS[props.character.id] ?? 'leaf',
    magicName: props.character.magicName,
  }),
)
</script>

<template>
  <article class="character-card" :style="{ '--char-color': character.color }" :lang="locale">
    <div class="character-card__window" aria-hidden="true" v-html="windowSvg"></div>
    <p class="character-card__record-mark">{{ T('result.specialCard.mark') }}</p>

    <p class="witch-card__specimen">
      <span class="witch-card__specimen-label">{{ T('card.specimenLabel') }}</span>
      &nbsp;·&nbsp;{{ witchName }}
    </p>

    <div class="character-card__magic-block">
      <span class="witch-card__magic-mark">
        <svg class="witch-card__mark-orn" width="46" height="7" viewBox="0 0 46 7" aria-hidden="true"><path d="M0 3.5 H36" stroke="currentColor" stroke-width="0.8" opacity="0.65"/><rect x="38" y="1.4" width="4.2" height="4.2" transform="rotate(45 40.1 3.5)" fill="currentColor"/></svg>
        {{ T('card.magicMark') }}
        <svg class="witch-card__mark-orn witch-card__mark-orn--flip" width="46" height="7" viewBox="0 0 46 7" aria-hidden="true"><path d="M0 3.5 H36" stroke="currentColor" stroke-width="0.8" opacity="0.65"/><rect x="38" y="1.4" width="4.2" height="4.2" transform="rotate(45 40.1 3.5)" fill="currentColor"/></svg>
      </span>
      <h2 class="character-card__magic-name">{{ character.magicName }}</h2>
      <div class="character-card__stages">
        <p class="character-card__stage-line">
          <span class="character-card__stage-label">{{ T('result.specialCard.beforeLabel') }}</span>
          {{ character.awakening.before }}
        </p>
        <p class="character-card__stage-line">
          <span class="character-card__stage-label">{{ T('result.specialCard.afterLabel') }}</span>
          {{ character.awakening.after }}
        </p>
      </div>
    </div>

    <hr class="witch-card__divider" />

    <section class="character-card__field">
      <span class="character-card__field-label">{{ T('card.labels.epithet') }}</span>
      <p class="character-card__epithet">{{ character.epithet }}</p>
    </section>

    <aside class="character-card__warden-note">
      <span class="character-card__warden-pin" aria-hidden="true">
        <!-- pushpin: shadow → needle → head → shine; plain hexes from the
             palette (gold family), no gradients/ids — export-safe -->
        <svg width="26" height="30" viewBox="0 0 26 30" fill="none">
          <g>
            <ellipse cx="17" cy="26" rx="5.5" ry="1.8" fill="#08060a" opacity="0.55" />
            <path d="M12.5 15 L16.5 25" stroke="#b3a892" stroke-width="1.4" stroke-linecap="round" />
            <circle cx="11" cy="9.5" r="6.8" fill="#ad7237" stroke="#6d4520" stroke-width="1" />
            <circle cx="8.8" cy="7.2" r="2.6" fill="#e8b04a" opacity="0.9" />
            <circle cx="7.8" cy="6.2" r="1" fill="#f7ead2" />
          </g>
        </svg>
      </span>
      <p class="character-card__warden-text">{{ wardenLine }}</p>
      <span class="character-card__warden-sig">——{{ T('result.specialCard.wardenTag') }}</span>
    </aside>

    <section class="character-card__field" style="text-align:center">
      <p class="character-card__quote">{{ character.quote }}</p>
    </section>

    <div class="witch-card__export-footer">
      <div class="witch-card__export-brand">
        <div class="brand">{{ T('share.exportTag') }}</div>
        <div class="cap">{{ T('share.qrCaption') }}</div>
      </div>
      <img v-if="qrSrc" class="witch-card__export-qr" :src="qrSrc" alt="" />
    </div>
  </article>
</template>
