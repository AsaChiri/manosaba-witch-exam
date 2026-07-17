/*
 * Per-(tag, locale) card asset (design spec §5 delivery contract, 2026-07-16).
 * One normalized, FALLBACK-RESOLVED Card per manifest tag × locale — exactly
 * what getCardOrFallback returns — so the island fetches a single URL with no
 * locale-fallback chain client-side. A tag with no card in ANY locale
 * (character-only coverage cells) emits nothing: the resulting HTTP 404 is the
 * island's "no record exists" signal. URL shape is owned by data-paths.ts.
 */
import type { APIRoute, GetStaticPaths } from 'astro'
import { listTags, getCardOrFallback } from '../../../../lib/content'
import { LOCALES, ASTRO_SEGMENT } from '../../../../i18n/config'
import type { Card } from '../../../../lib/content-types'

export const getStaticPaths = (() => {
  const paths: Array<{ params: { locale: string; tag: string }; props: { card: Card } }> = []
  for (const locale of LOCALES) {
    for (const tag of listTags()) {
      const card = getCardOrFallback(tag, locale)
      if (card) paths.push({ params: { locale: ASTRO_SEGMENT[locale], tag }, props: { card } })
    }
  }
  return paths
}) satisfies GetStaticPaths

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify((props as { card: Card }).card), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
