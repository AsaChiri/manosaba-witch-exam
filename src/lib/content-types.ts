/*
 * Normalized content types + pure helpers — the UI-facing shapes, zod-free.
 * Island code (Vue components, the fetch layer) imports from HERE so the zod
 * schema module (content-schema.ts, which re-exports these) never enters the
 * client bundle graph. Server/build code may import from either.
 */
import type { Locale } from '../i18n/config'

export interface Cell {
  origin: string
  coping: string
  label: string
}
export interface Magic {
  name: string
  text: string
}
export interface Card {
  tag: string
  locale: Locale
  cell: Cell
  epithet: string
  magic: Magic
  crime: string[]
  execution: string[]
  epitaph: string
  meta?: { pattern?: 'A' | 'B' }
}

export interface WitchCharacter {
  id: string
  tag: string
  color: string
  locale: Locale
  name: string
  magicName: string
  awakening: { before: string; after: string }
  /** The character's 原罪 — the record's epithet field. */
  epithet: string
  /** The character's artbook signature quote — the record's closing line. */
  quote: string
  /** Per-character warden remark (required; authored per character). */
  warden: string
}

export interface TagInfo {
  cell: string
  origin: string
  coping: string
  cellLabel: string
  locales: Locale[]
}
export interface Manifest {
  version: string
  tags: Record<string, TagInfo>
}
export interface ContentMeta {
  contentVersion: string
  quizVersion: string
  /** Busts the runtime /data/ card+character JSON fetches (design spec §5,
   *  2026-07-16). Separate from contentVersion so prose edits never invalidate
   *  saved exam progress. Absent in older packages/fixtures. */
  assetsVersion?: string
  phase?: 'soft' | 'launch'
  corpus: { authoredTags: number; cells: number; locales: Locale[] }
}

/** The card's display title: canon knows a witch by her magic's name.
 *  The name is structurally required (compiler hard-fails without it) — no fallback. */
export function cardTitle(card: Card): string {
  return card.magic.name
}
