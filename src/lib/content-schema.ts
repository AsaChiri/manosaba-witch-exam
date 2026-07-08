/*
 * Content package schema (design spec §5), validated with zod.
 *
 * Two layers:
 *  - RAW schemas match the on-disk shape emitted by the sibling compiler
 *    (`content/`) and mirrored by the fixtures: cards wrap fields in
 *    `variants[].fields`, `magic` is a single string, `cell` is "FAMILY|Style".
 *  - NORMALIZED types are what the UI consumes (epithet/magic{name?,text}/
 *    crime[]/execution[]/epitaph + a display cell). `normalizeCard` bridges them
 *    so components never see the raw shape.
 */
import { z } from 'zod'
import { LOCALES } from '../i18n/config'

export const localeSchema = z.enum(['zh-CN', 'en', 'ja', 'zh-TW'])
export type Locale = z.infer<typeof localeSchema>

// ── RAW (on-disk) ──
export const rawFieldsSchema = z.object({
  epithet: z.string(),
  magic: z.string(),
  crime: z.array(z.string()).min(1),
  execution: z.array(z.string()).min(1),
  epitaph: z.string(),
})
export const rawCardSchema = z
  .object({
    tag: z.string(),
    locale: localeSchema,
    cell: z.string(),
    family: z.string().optional(),
    style: z.string().optional(),
    copingSub: z.string().optional(),
    originSub: z.string().optional(),
    variants: z
      .array(z.object({ variant: z.number().optional(), fields: rawFieldsSchema }))
      .min(1),
  })
  .passthrough()

export const rawTagInfoSchema = z
  .object({
    cell: z.string(),
    copingSub: z.string().optional(),
    originSub: z.string().optional(),
    tag: z.string().optional(),
    variants: z.union([z.number(), z.array(z.unknown())]).optional(),
    locales: z.array(localeSchema).min(1),
  })
  .passthrough()

export const rawManifestSchema = z
  .object({
    tags: z.record(z.string(), rawTagInfoSchema),
    cells: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const rawMetaSchema = z
  .object({
    contentVersion: z.string(),
    quizVersion: z.string(),
    locales: z.array(localeSchema),
    phase: z.enum(['soft', 'launch']).optional(),
    counts: z
      .object({
        shippedTags: z.number().optional(),
        authoredCells: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

// ── NORMALIZED (UI-facing) ──
export interface Cell {
  origin: string
  coping: string
  label: string
}
export interface Magic {
  name?: string
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
  phase?: 'soft' | 'launch'
  corpus: { authoredTags: number; cells: number; locales: Locale[] }
}

// ── Normalizers ──
function splitCell(cell: string): [string, string] {
  const [a, b] = cell.split('|')
  return [a ?? cell, b ?? '']
}

/** Split the authored magic string into its name and body.
 *  Corpus forms: 「吞尽」——她能…, "牵引"——她能…, 「食べ尽くし」——彼女は…,
 *  Devour to Nothing — she can… . Returns name-less on no match. */
export function splitMagic(raw: string): Magic {
  const quoted = raw.match(/^\s*[「『"“']([^」』"”']{1,40})[」』"”']\s*(?:——|――|—|–|-)?\s*(\S[\s\S]*)$/)
  if (quoted) return { name: quoted[1].trim(), text: quoted[2] }
  const dashed = raw.match(/^\s*([^—–]{2,60}?)\s*(?:——|――|—|–)\s+(\S[\s\S]*)$/)
  if (dashed) return { name: dashed[1].trim(), text: dashed[2] }
  return { text: raw }
}

/** The card's display title: canon knows a witch by her magic's name. */
export function cardTitle(card: Card): string {
  return card.magic.name ?? card.epithet
}

export function normalizeCard(raw: z.infer<typeof rawCardSchema>): Card {
  const [family, style] = splitCell(raw.cell)
  const origin = raw.family ?? family
  const coping = raw.style ?? style
  const fields = raw.variants[0].fields
  return {
    tag: raw.tag,
    locale: raw.locale,
    cell: { origin, coping, label: raw.tag.replace('_', ' · ') },
    epithet: fields.epithet,
    magic: splitMagic(fields.magic),
    crime: fields.crime,
    execution: fields.execution,
    epitaph: fields.epitaph,
  }
}

export function normalizeManifest(
  raw: z.infer<typeof rawManifestSchema>,
  version: string,
): Manifest {
  const tags: Record<string, TagInfo> = {}
  for (const [tag, info] of Object.entries(raw.tags)) {
    const [family, style] = splitCell(info.cell)
    tags[tag] = {
      cell: info.cell,
      origin: family,
      coping: style,
      cellLabel: tag.replace('_', ' · '),
      locales: info.locales,
    }
  }
  return { version, tags }
}

export function normalizeMeta(raw: z.infer<typeof rawMetaSchema>): ContentMeta {
  return {
    contentVersion: raw.contentVersion,
    quizVersion: raw.quizVersion,
    phase: raw.phase,
    corpus: {
      authoredTags: raw.counts?.shippedTags ?? Object.keys({}).length,
      cells: raw.counts?.authoredCells ?? 0,
      locales: raw.locales,
    },
  }
}

export const ALL_LOCALES = LOCALES
