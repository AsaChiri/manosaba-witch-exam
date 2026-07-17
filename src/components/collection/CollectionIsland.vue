<script setup lang="ts">
/*
 * The archive (design: unadvertised collection page). A client-only island
 * because the collected-TAG set lives only in this device's localStorage.
 * Renders the subset of the authored catalog the visitor has reached; hides the
 * catalog total until they're a genuine collector (COLLECTOR_REVEAL_THRESHOLD).
 *
 * Content-lean: the trimmed `catalog` (title + epithet per tag) arrives as a
 * prop from the server — the island never imports the content layer. Each tile
 * links to the existing card page with the #collector flag (which suppresses
 * that page's newcomer CTA and shows a return link instead).
 */
import {
  loadCollected,
  loadCollectedCharacters,
  COLLECTOR_REVEAL_THRESHOLD,
} from '../../lib/collection'
import { t } from '../../i18n'
import { localePath, type Locale } from '../../i18n/config'
// rose-window is pure geometry (no content import) — the island stays content-lean
import { roseWindowSvg, CHARACTER_MOTIFS } from '../../lib/rose-window'
import Seal from '../exam/Seal.vue'

interface Entry {
  title: string
  epithet: string
}
interface CharacterEntry {
  magicName: string
  epithet: string
  color: string
}
const props = defineProps<{
  locale: Locale
  catalog: Record<string, Entry>
  total: number
  characterCatalog: Record<string, CharacterEntry>
}>()
const T = (k: string, p?: Record<string, string | number>) => t(props.locale, k, p)

// Runs in the browser (client:only). Keep only tags still authored; newest first.
const tags = loadCollected()
  .filter((tag) => props.catalog[tag])
  .reverse()

/* Special character records (§3.7) — rendered ONLY once at least one is
 * collected. The section (and that the set exists at all) is never advertised
 * beforehand, consistent with the archive's hidden-total design. */
const chars = loadCollectedCharacters()
  .filter((id) => props.characterCatalog[id])
  .reverse()

// Every tile on the shelf counts — special records included, so a
// special-only collector (character cell with no normal card) isn't shown
// the empty state.
const count = tags.length + chars.length
const revealed = count >= COLLECTOR_REVEAL_THRESHOLD

function href(tag: string): string {
  return localePath(props.locale, `/r/${tag}/`) + '#collector'
}
function charHref(id: string): string {
  return localePath(props.locale, `/c/${id}/`) + '#collector'
}

/* Her rose window as the tile crest — the record's own mark, not the generic
 * seal (deterministic SVG from lib/rose-window; safe for v-html). */
function charWindow(id: string): string {
  const c = props.characterCatalog[id]
  return roseWindowSvg({
    color: c.color,
    motif: CHARACTER_MOTIFS[id] ?? 'ray',
    magicName: c.magicName,
  })
}
</script>

<template>
  <section class="collection" :lang="locale">
    <header class="collection__head">
      <h1 class="collection__title">{{ T('collection.title') }}</h1>
      <p class="collection__intro">{{ T('collection.intro') }}</p>
    </header>

    <template v-if="count > 0">
      <p class="collection__count">
        {{ revealed ? T('collection.countTotal', { count, total }) : T('collection.count', { count }) }}
      </p>
      <p v-if="revealed" class="collection__collector">{{ T('collection.collectorNote', { total }) }}</p>

      <ul v-if="tags.length > 0" class="collection__grid">
        <li v-for="tag in tags" :key="tag">
          <a class="collection-tile" :href="href(tag)">
            <span class="collection-tile__crest">
              <Seal :size="40" stained :title="T('meta.siteName')" />
            </span>
            <span class="collection-tile__mark">{{ T('card.magicMark') }}</span>
            <h2 class="collection-tile__name">{{ catalog[tag].title }}</h2>
            <p class="collection-tile__epithet">{{ catalog[tag].epithet }}</p>
          </a>
        </li>
      </ul>

      <template v-if="chars.length > 0">
        <ul class="collection__grid">
          <li v-for="id in chars" :key="id">
            <a
              class="collection-tile collection-tile--char"
              :href="charHref(id)"
              :style="{ '--char-color': characterCatalog[id].color }"
            >
              <span class="collection-tile__window" aria-hidden="true" v-html="charWindow(id)"></span>
              <h2 class="collection-tile__name collection-tile__name--char">
                {{ characterCatalog[id].magicName }}
              </h2>
              <p class="collection-tile__epithet">{{ characterCatalog[id].epithet }}</p>
            </a>
          </li>
        </ul>
      </template>
    </template>

    <div v-else class="collection__empty">
      <p class="collection__empty-line">{{ T('collection.empty') }}</p>
      <a class="collection__empty-cta" :href="localePath(locale, '/exam/')">{{ T('collection.emptyCta') }}</a>
    </div>
  </section>
</template>

<style scoped>
.collection {
  flex: 1;
  width: min(54rem, 100%);
  margin-inline: auto;
  padding: clamp(2rem, 6vh, 4rem) 1.2rem 5rem;
  animation: rise-fade 500ms var(--ease-ceremony) both;
}
.collection__title {
  font-family: var(--font-inscription);
  font-weight: 600;
  font-size: clamp(1.6rem, 5vw, 2.3rem);
  letter-spacing: 0.06em;
  color: var(--bone);
}
.collection__intro {
  margin-top: 0.7rem;
  color: var(--bone-dim);
  font-family: var(--font-body);
  line-height: 1.7;
  text-wrap: pretty;
}
.collection__count {
  margin-top: 1.9rem;
  font-family: var(--font-instrument);
  letter-spacing: 0.08em;
  color: var(--witch-violet);
}
.collection__collector {
  margin-top: 0.4rem;
  color: var(--bone-dim);
  font-family: var(--font-body);
  font-style: var(--font-style-em);
}
.collection__grid {
  list-style: none;
  margin: 2.2rem 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 1rem;
}
.collection-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  height: 100%;
  padding: 1.5rem 1.1rem 1.6rem;
  text-align: center;
  text-decoration: none;
  background: color-mix(in srgb, var(--velvet) 78%, transparent);
  border: 1px solid var(--hairline-faint);
  transition: border-color 200ms var(--ease-ceremony), transform 200ms var(--ease-ceremony);
}
.collection-tile:hover,
.collection-tile:focus-visible {
  border-color: color-mix(in srgb, var(--witch-violet) 45%, transparent);
  transform: translateY(-2px);
}
.collection-tile__crest {
  color: var(--verdict-gold);
  line-height: 0;
}
.collection-tile__mark {
  font-family: var(--font-instrument);
  font-size: 0.62rem;
  letter-spacing: 0.34em;
  text-indent: 0.34em;
  color: var(--verdict-gold-deep);
}
.collection-tile__name {
  font-family: var(--font-inscription);
  font-weight: 600;
  font-size: 1.05rem;
  line-height: 1.25;
  color: var(--witch-violet);
  text-shadow: 0 0 14px color-mix(in srgb, var(--witch-violet) 28%, transparent);
}
.collection-tile__epithet {
  font-family: var(--font-body);
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--bone-dim);
  text-wrap: pretty;
}

/* Special character records (§3.7): the tile carries the character's theme
 * color — the one sanctioned exception to the violet archive. */
.collection__special-title {
  margin-top: 2.6rem;
  font-family: var(--font-instrument);
  font-size: 0.9rem;
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  color: var(--verdict-gold-deep);
  text-transform: uppercase;
}
.collection__special-title + .collection__grid {
  margin-top: 1.1rem;
}
.collection-tile--char:hover,
.collection-tile--char:focus-visible {
  border-color: color-mix(in srgb, var(--char-color) 55%, transparent);
}
.collection-tile__window {
  width: 4.5rem;
  line-height: 0;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--char-color) 35%, transparent));
}
.collection-tile__window :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
.collection-tile__name--char {
  color: color-mix(in srgb, var(--char-color) 78%, var(--bone));
  text-shadow: 0 0 14px color-mix(in srgb, var(--char-color) 30%, transparent);
}
.collection__empty {
  margin-top: 3rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.6rem;
  text-align: center;
}
.collection__empty-line {
  color: var(--bone-dim);
  font-family: var(--font-body);
  line-height: 1.7;
  max-width: 34ch;
}
.collection__empty-cta {
  font-family: var(--font-instrument);
  letter-spacing: 0.08em;
  color: var(--magica-pink);
  border: 1px solid color-mix(in srgb, var(--magica-pink) 55%, transparent);
  padding: 0.7rem 1.6rem;
  text-decoration: none;
  transition: background-color 200ms var(--ease-ceremony);
}
.collection__empty-cta:hover {
  background: color-mix(in srgb, var(--magica-pink) 12%, transparent);
}
</style>
