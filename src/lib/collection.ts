/*
 * The collection / archive: the cards a visitor has reached across retakes.
 *
 * Deliberately kept in its own module with NO dependency on the content layer
 * (`content.ts` eager-imports the whole card corpus). This lets the collection
 * island and the discreet footer link ship a tiny, content-free bundle, and
 * keeps the near-zero-JS card share surface clean.
 *
 * Unlike exam progress, this store is NOT content-hash gated: a card TAG is a
 * stable identity, so a content release must never wipe someone's collection.
 * Stale TAGs (no longer authored) are tolerated here and skipped at render time.
 * Every access is failure-tolerant (private mode / disabled storage).
 */

const COLLECTION_KEY = 'manosaba-exam-collection-v1'

interface StoredCollection {
  version: 1
  tags: string[]
  /** Special character records reached (§3.7) — character ids. Optional so
   *  pre-feature payloads keep loading; ids are stable like tags. */
  chars?: string[]
}

/**
 * At/above this many distinct collected cards, the archive stops hiding the
 * catalog total (design: hidden until you're a genuine collector). A plain
 * one-line knob — retune freely as the ~440-card corpus and real retake
 * behaviour settle. Read only by the collection island's reveal logic.
 */
export const COLLECTOR_REVEAL_THRESHOLD = 12

function loadStore(): StoredCollection | null {
  try {
    const raw = localStorage.getItem(COLLECTION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCollection
    if (parsed?.version !== 1 || !Array.isArray(parsed.tags)) return null
    return parsed
  } catch {
    return null
  }
}

function saveStore(store: StoredCollection): void {
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(store))
  } catch {
    /* quota / disabled — silent */
  }
}

/** The collected TAGs in insertion order (the island reverses for recent-first). */
export function loadCollected(): string[] {
  return (loadStore()?.tags ?? []).filter((t): t is string => typeof t === 'string')
}

/** The special character ids reached (§3.7), insertion order. */
export function loadCollectedCharacters(): string[] {
  const chars = loadStore()?.chars
  return Array.isArray(chars) ? chars.filter((c): c is string => typeof c === 'string') : []
}

/** Append a reached card TAG (deduped). Called when an exam resolves to a card. */
export function recordCollected(tag: string): void {
  if (!tag) return
  const store = loadStore() ?? { version: 1 as const, tags: [] }
  if (store.tags.includes(tag)) return
  store.tags.push(tag)
  saveStore(store)
}

/** Append a reached special character id (deduped, §3.7). */
export function recordCharacter(id: string): void {
  if (!id) return
  const store = loadStore() ?? { version: 1 as const, tags: [] }
  const chars = Array.isArray(store.chars) ? store.chars : []
  if (chars.includes(id)) return
  chars.push(id)
  store.chars = chars
  saveStore(store)
}

/** Has the visitor collected at least one card (i.e. finished ≥1 exam)?
 * Gates the discreet footer link so it only appears to returning collectors. */
export function hasCollected(): boolean {
  return loadCollected().length > 0
}
