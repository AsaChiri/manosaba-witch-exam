/*
 * i18n configuration — the single source of truth for locales, route
 * prefixes, and the mapping between our catalog keys (`zh-CN`) and Astro's
 * lowercase routing segment (`zh-cn`). Framework-agnostic: imported by both
 * .astro pages and the Vue island.
 */

export type Locale = 'zh-CN' | 'en' | 'ja' | 'zh-TW'

export const LOCALES: readonly Locale[] = ['zh-CN', 'en', 'ja', 'zh-TW'] as const
export const DEFAULT_LOCALE: Locale = 'zh-CN'

/** Catalog key → Astro routing segment (lowercase, per astro.config i18n). */
export const ASTRO_SEGMENT: Record<Locale, string> = {
  'zh-CN': 'zh-cn',
  en: 'en',
  ja: 'ja',
  'zh-TW': 'zh-tw',
}

/** URL path prefix. zh-CN is the bare root; others get a prefix segment. */
export const PATH_PREFIX: Record<Locale, string> = {
  'zh-CN': '',
  en: '/en',
  ja: '/ja',
  'zh-TW': '/zh-tw',
}

/** The `<html lang>` value + `og:locale`. */
export const HTML_LANG: Record<Locale, string> = {
  'zh-CN': 'zh-CN',
  en: 'en',
  ja: 'ja',
  'zh-TW': 'zh-TW',
}
export const OG_LOCALE: Record<Locale, string> = {
  'zh-CN': 'zh_CN',
  en: 'en_US',
  ja: 'ja_JP',
  'zh-TW': 'zh_TW',
}
export const HREFLANG: Record<Locale, string> = {
  'zh-CN': 'zh-Hans',
  en: 'en',
  ja: 'ja',
  'zh-TW': 'zh-Hant',
}

/** Native display name for the locale switcher. */
export const LOCALE_NAME: Record<Locale, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  ja: '日本語',
  'zh-TW': '繁體中文',
}

/** Prefix a locale-relative path (starting with `/`). */
export function localePath(locale: Locale, path = '/'): string {
  const prefix = PATH_PREFIX[locale]
  if (path === '/') return prefix ? `${prefix}/` : '/'
  const p = path.startsWith('/') ? path : `/${path}`
  return `${prefix}${p}`
}

/** Strip any known locale prefix from a pathname, returning the bare path. */
export function stripLocale(pathname: string): { locale: Locale; rest: string } {
  for (const loc of LOCALES) {
    const prefix = PATH_PREFIX[loc]
    if (!prefix) continue
    if (pathname === prefix || pathname === `${prefix}/`) return { locale: loc, rest: '/' }
    if (pathname.startsWith(`${prefix}/`)) return { locale: loc, rest: pathname.slice(prefix.length) }
  }
  return { locale: DEFAULT_LOCALE, rest: pathname || '/' }
}

/** Translate the current pathname into its equivalent in another locale,
 * preserving trailing segments (e.g. `/r/<tag>/`). */
export function pathForLocale(currentPath: string, target: Locale): string {
  const { rest } = stripLocale(currentPath)
  return localePath(target, rest)
}

/** Map a raw Accept-Language / navigator tag to one of our locales. */
export function mapBrowserLang(tag: string): Locale | null {
  const lower = tag.toLowerCase()
  if (
    lower.startsWith('zh-tw') ||
    lower.startsWith('zh-hk') ||
    lower.startsWith('zh-mo') ||
    lower.startsWith('zh-hant')
  ) {
    return 'zh-TW'
  }
  if (lower === 'zh' || lower.startsWith('zh-cn') || lower.startsWith('zh-hans') || lower.startsWith('zh')) {
    return 'zh-CN'
  }
  if (lower.startsWith('ja')) return 'ja'
  if (lower.startsWith('en')) return 'en'
  return null
}
