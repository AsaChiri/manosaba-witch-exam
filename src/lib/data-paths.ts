/*
 * /data/ asset URL scheme (design spec §5 delivery contract, 2026-07-16).
 * The ONLY place these URLs are built — the static endpoints under
 * src/pages/data/ and the island fetch layer (card-fetch.ts) both go through
 * here so the two sides can never drift. Locale segments follow the OG-image
 * convention (ASTRO_SEGMENT: zh-cn/en/ja/zh-tw — every locale gets a distinct
 * non-empty directory, unlike the page-path prefix where zh-CN is bare).
 */
import { ASTRO_SEGMENT, LOCALES, type Locale } from '../i18n/config'

export function cardDataPath(locale: Locale, tag: string): string {
  return `/data/cards/${ASTRO_SEGMENT[locale]}/${tag}.json`
}

export function characterDataPath(locale: Locale, id: string): string {
  return `/data/characters/${ASTRO_SEGMENT[locale]}/${id}.json`
}

/** Reverse map for the endpoints' [locale] param (a segment, not a Locale). */
export const SEGMENT_TO_LOCALE: Record<string, Locale> = Object.fromEntries(
  LOCALES.map((l) => [ASTRO_SEGMENT[l], l]),
) as Record<string, Locale>
