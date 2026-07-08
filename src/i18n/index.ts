/*
 * Tiny message helper shared by .astro pages and the Vue island. One catalog
 * source (JSON per locale); `t()` does dotted-key lookup with {param}
 * interpolation and falls back to the default locale for any gap.
 */
import { DEFAULT_LOCALE, type Locale } from './config'
import zhCN from './zh-CN.json'
import en from './en.json'
import ja from './ja.json'
import zhTW from './zh-TW.json'

/** Widen JSON string-literal types to `string` so every locale's catalog is
 * structurally the same shape — this makes a missing key a compile error. */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? Widen<U>[]
        : T extends object
          ? { [K in keyof T]: Widen<T[K]> }
          : T

export type Messages = Widen<typeof zhCN>

const CATALOGS: Record<Locale, Messages> = {
  'zh-CN': zhCN,
  en,
  ja,
  'zh-TW': zhTW,
}

/** Return the full typed catalog for structured access (arrays/objects). */
export function messages(locale: Locale): Messages {
  return CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE]
}

function resolve(obj: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part]
    }
    return undefined
  }, obj)
}

function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in params ? String(params[k]) : m,
  )
}

/** Look up a dotted key in `locale`, falling back to the default locale. */
export function t(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  let hit = resolve(CATALOGS[locale], key)
  if (typeof hit !== 'string') hit = resolve(CATALOGS[DEFAULT_LOCALE], key)
  if (typeof hit !== 'string') return key
  return interpolate(hit, params)
}

/** Bind `t` to a locale — convenient inside a component. */
export function createT(locale: Locale) {
  return (key: string, params?: Record<string, string | number>) => t(locale, key, params)
}
