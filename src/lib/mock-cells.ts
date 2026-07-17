/*
 * Dev-only cell candidates for the mock engine. Imported ONLY by
 * mock-engine.ts, which engine.ts selects behind the build-time-constant
 * PUBLIC_USE_MOCK_ENGINE fold — so this module (and the manifest JSON it
 * globs) is statically eliminated from production bundles along with the mock.
 * The real engine resolves from its rule tables and never needs cells.
 */
import type { CellCandidate } from './engine-api'

const contentManifest = import.meta.glob<{ default: unknown }>(
  '/content/cards/manifest.json',
  { eager: true },
)
const fixtureManifest = import.meta.glob<{ default: unknown }>(
  '../fixtures/manifest.json',
  { eager: true },
)

function firstModule(mods: Record<string, { default: unknown }>): unknown | null {
  const keys = Object.keys(mods)
  return keys.length ? mods[keys[0]].default : null
}

interface RawManifestish {
  tags?: Record<string, { cell?: string }>
}

function toCells(raw: unknown): CellCandidate[] {
  const tags = (raw as RawManifestish | null)?.tags ?? {}
  return Object.entries(tags).map(([tag, info]) => {
    const cell = String(info?.cell ?? '')
    const [origin = cell, coping = ''] = cell.split('|')
    return { tag, cell, origin, coping }
  })
}

export const MOCK_CELLS: CellCandidate[] = toCells(
  firstModule(contentManifest) ?? firstModule(fixtureManifest),
)
