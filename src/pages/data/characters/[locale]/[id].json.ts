/*
 * Per-(character, locale) special-record asset (design spec §3.7 + §5 delivery
 * contract, 2026-07-16). The exam island fetches the record's prose from here
 * only on an actual exact-hit trigger — the prose never rides in page HTML.
 * listCharacters already applies the zh-CN fallback per locale and returns []
 * when the feature is off (ship_list characters=false), which zeroes the paths.
 */
import type { APIRoute, GetStaticPaths } from 'astro'
import { listCharacters } from '../../../../lib/content'
import { LOCALES, ASTRO_SEGMENT } from '../../../../i18n/config'
import type { WitchCharacter } from '../../../../lib/content-types'

export const getStaticPaths = (() => {
  const paths: Array<{
    params: { locale: string; id: string }
    props: { character: WitchCharacter }
  }> = []
  for (const locale of LOCALES) {
    for (const character of listCharacters(locale)) {
      paths.push({ params: { locale: ASTRO_SEGMENT[locale], id: character.id }, props: { character } })
    }
  }
  return paths
}) satisfies GetStaticPaths

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify((props as { character: WitchCharacter }).character), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
