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
import { loadCollected, COLLECTOR_REVEAL_THRESHOLD } from '../../lib/collection'
import { t } from '../../i18n'
import { localePath, type Locale } from '../../i18n/config'
import Seal from '../exam/Seal.vue'

interface Entry {
  title: string
  epithet: string
}
const props = defineProps<{
  locale: Locale
  catalog: Record<string, Entry>
  total: number
}>()
const T = (k: string, p?: Record<string, string | number>) => t(props.locale, k, p)

// Runs in the browser (client:only). Keep only tags still authored; newest first.
const tags = loadCollected()
  .filter((tag) => props.catalog[tag])
  .reverse()
const count = tags.length
const revealed = count >= COLLECTOR_REVEAL_THRESHOLD

function href(tag: string): string {
  return localePath(props.locale, `/r/${tag}/`) + '#collector'
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

      <ul class="collection__grid">
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
  font-style: italic;
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
