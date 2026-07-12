/*
 * Content access layer. Reads the compiled content package from `content/`
 * when the sibling compiler has produced it, else the fixtures under
 * `src/fixtures/`. On-disk cards are the RAW shape (variants[].fields); this
 * module validates with zod and normalizes to the UI-facing Card shape, so
 * pages/components never see the raw layout. The `content/` package is owned by
 * another agent and treated as read-only.
 */
import {
  rawCardSchema,
  rawManifestSchema,
  rawMetaSchema,
  normalizeCard,
  normalizeManifest,
  normalizeMeta,
  type Card,
  type Manifest,
  type ContentMeta,
} from './content-schema'
import type { Locale } from '../i18n/config'
import { LOCALES, DEFAULT_LOCALE } from '../i18n/config'

// ── Fixtures (fallback) ──
const fixtureCardModules = import.meta.glob<{ default: unknown }>(
  '../fixtures/cards/*.json',
  { eager: true },
)
import fixtureManifest from '../fixtures/manifest.json'
import fixtureMeta from '../fixtures/meta.json'

// ── Real content package (present once the compiler has run) ──
const contentCardModules = import.meta.glob<{ default: unknown }>(
  '/content/cards/*.json',
  { eager: true },
)
const contentManifestModules = import.meta.glob<{ default: unknown }>(
  '/content/cards/manifest.json',
  { eager: true },
)
const contentMetaModules = import.meta.glob<{ default: unknown }>(
  '/content/meta.json',
  { eager: true },
)

function firstModule(mods: Record<string, { default: unknown }>): unknown | null {
  const keys = Object.keys(mods)
  return keys.length ? mods[keys[0]].default : null
}

export const usingRealContent = Object.keys(contentManifestModules).length > 0

const cardModules = usingRealContent ? contentCardModules : fixtureCardModules
const rawMetaSource = usingRealContent ? firstModule(contentMetaModules) : fixtureMeta
const rawManifestSource = usingRealContent
  ? firstModule(contentManifestModules)
  : fixtureManifest

function isCardFile(path: string): boolean {
  return /\.(?:zh-CN|zh-TW|en|ja)\.json$/.test(path)
}

function buildCardIndex(): Map<string, Card> {
  const index = new Map<string, Card>()
  for (const [path, mod] of Object.entries(cardModules)) {
    if (!isCardFile(path)) continue // skip manifest.json etc.
    const parsed = rawCardSchema.safeParse(mod.default)
    if (!parsed.success) {
      throw new Error(`Invalid card at ${path}: ${parsed.error.issues[0]?.message}`)
    }
    const card = normalizeCard(parsed.data)
    index.set(`${card.tag}::${card.locale}`, card)
  }
  return index
}

const CARD_INDEX = buildCardIndex()

const CONTENT_META: ContentMeta = normalizeMeta(rawMetaSchema.parse(rawMetaSource))
const MANIFEST: Manifest = normalizeManifest(
  rawManifestSchema.parse(rawManifestSource),
  CONTENT_META.contentVersion,
)

export function getManifest(): Manifest {
  return MANIFEST
}
export function getContentMeta(): ContentMeta {
  return CONTENT_META
}

/** Content hash for localStorage invalidation (design spec §4). */
export const CONTENT_HASH = `${CONTENT_META.contentVersion}~${CONTENT_META.quizVersion}`

export function getCard(tag: string, locale: Locale): Card | null {
  return CARD_INDEX.get(`${tag}::${locale}`) ?? null
}

/** Best-effort card: requested locale, else default locale, else any. */
export function getCardOrFallback(tag: string, locale: Locale): Card | null {
  return (
    getCard(tag, locale) ??
    getCard(tag, DEFAULT_LOCALE) ??
    LOCALES.map((l) => getCard(tag, l)).find(Boolean) ??
    null
  )
}

/** All (tag, locale) pairs that have an authored card — for getStaticPaths. */
export function listCardParams(): Array<{ tag: string; locale: Locale }> {
  const out: Array<{ tag: string; locale: Locale }> = []
  for (const [tag, info] of Object.entries(MANIFEST.tags)) {
    for (const locale of info.locales) {
      if (getCard(tag, locale)) out.push({ tag, locale })
    }
  }
  return out
}

export function listTags(): string[] {
  return Object.keys(MANIFEST.tags)
}

/** Specimen for the landing (the Nameless Witch preview). */
export function getSpecimenCard(locale: Locale): Card | null {
  const first = Object.keys(MANIFEST.tags)[0]
  if (!first) return null
  return getCardOrFallback(first, locale)
}
