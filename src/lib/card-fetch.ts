/*
 * Island-side fetch layer for the /data/ card + character assets (design spec
 * §5 delivery contract, 2026-07-16). Runs only in the browser (imported by the
 * exam island); never imports the content layer or zod.
 *
 * Outcome semantics: HTTP 404 is a SEMANTIC result — "no card exists at this
 * tag" (character-only cells, unshipped tags) — mapped to {kind:'absent'} and
 * never retried. Everything else (network failure, non-JSON 200 from a captive
 * portal, bad shape, 5xx) throws, with ONE transparent auto-retry. The retry
 * delay lives here, strictly after tag resolution — the engine's determinism
 * rule (no timers/randomness in any resolution path) is untouched.
 */
import type { Card, WitchCharacter } from './content-types'
import type { Locale } from '../i18n/config'
import { cardDataPath, characterDataPath } from './data-paths'

export type AssetOutcome<T> = { kind: 'hit'; data: T } | { kind: 'absent' }

const RETRY_DELAY_MS = 750

/** Memoized in-flight/settled fetches (retake to the same tag reuses a hit;
 *  a REJECTED promise is evicted so a manual retry re-fetches). */
const memoized = new Map<string, Promise<AssetOutcome<unknown>>>()

async function fetchAsset<T>(
  url: string,
  guard: (data: unknown) => boolean,
): Promise<AssetOutcome<T>> {
  const attempt = async (): Promise<AssetOutcome<T>> => {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (res.status === 404) return { kind: 'absent' }
    if (!res.ok) throw new Error(`asset fetch ${res.status}: ${url}`)
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('json')) throw new Error(`asset non-JSON response: ${url}`)
    const data: unknown = await res.json()
    if (!guard(data)) throw new Error(`asset shape mismatch: ${url}`)
    return { kind: 'hit', data: data as T }
  }
  try {
    return await attempt()
  } catch {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    return attempt()
  }
}

function memo<T>(key: string, make: () => Promise<AssetOutcome<T>>): Promise<AssetOutcome<T>> {
  const existing = memoized.get(key)
  if (existing) return existing as Promise<AssetOutcome<T>>
  const p = make()
  memoized.set(key, p)
  p.catch(() => memoized.delete(key))
  return p
}

/* Light structural guards — presence of the fields the result surface renders;
 * full zod validation already happened when the asset was emitted at build. */
function looksLikeCard(data: unknown): boolean {
  const c = data as Card | null
  return (
    !!c &&
    typeof c.tag === 'string' &&
    typeof c.magic?.name === 'string' &&
    typeof c.magic?.text === 'string' &&
    Array.isArray(c.crime) &&
    Array.isArray(c.execution)
  )
}
function looksLikeCharacter(data: unknown): boolean {
  const c = data as WitchCharacter | null
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.magicName === 'string' &&
    typeof c.awakening?.before === 'string' &&
    typeof c.awakening?.after === 'string'
  )
}

export function fetchCardAsset(
  locale: Locale,
  tag: string,
  assetsVersion: string,
): Promise<AssetOutcome<Card>> {
  const url = `${cardDataPath(locale, tag)}?v=${encodeURIComponent(assetsVersion)}`
  return memo(`card:${locale}:${tag}:${assetsVersion}`, () => fetchAsset<Card>(url, looksLikeCard))
}

export function fetchCharacterAsset(
  locale: Locale,
  id: string,
  assetsVersion: string,
): Promise<AssetOutcome<WitchCharacter>> {
  const url = `${characterDataPath(locale, id)}?v=${encodeURIComponent(assetsVersion)}`
  return memo(`char:${locale}:${id}:${assetsVersion}`, () =>
    fetchAsset<WitchCharacter>(url, looksLikeCharacter),
  )
}
