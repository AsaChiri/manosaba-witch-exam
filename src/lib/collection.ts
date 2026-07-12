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
}

/**
 * At/above this many distinct collected cards, the archive stops hiding the
 * catalog total (design: hidden until you're a genuine collector). A plain
 * one-line knob — retune freely as the ~440-card corpus and real retake
 * behaviour settle. Read only by the collection island's reveal logic.
 */
export const COLLECTOR_REVEAL_THRESHOLD = 12

/** The collected TAGs in insertion order (the island reverses for recent-first). */
export function loadCollected(): string[] {
  try {
    const raw = localStorage.getItem(COLLECTION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredCollection
    if (parsed?.version !== 1 || !Array.isArray(parsed.tags)) return []
    return parsed.tags.filter((t): t is string => typeof t === 'string')
  } catch {
    return []
  }
}

/** Append a reached card TAG (deduped). Called when an exam resolves to a card. */
export function recordCollected(tag: string): void {
  if (!tag) return
  try {
    const tags = loadCollected()
    if (tags.includes(tag)) return
    tags.push(tag)
    const payload: StoredCollection = { version: 1, tags }
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(payload))
  } catch {
    /* quota / disabled — silent */
  }
}

/** Has the visitor collected at least one card (i.e. finished ≥1 exam)?
 * Gates the discreet footer link so it only appears to returning collectors. */
export function hasCollected(): boolean {
  return loadCollected().length > 0
}
