/*
 * localStorage persistence (design spec §4), ported from v1's content-hash
 * invalidation pattern. Exam progress is invalidated when the content/quiz
 * version changes; consent is kept under its own key so a content bump never
 * silently revokes it.
 */
import type { ExamSnapshot } from './engine-api'

const CONSENT_KEY = 'manosaba-exam-consent-v1'
const PROGRESS_KEY = 'manosaba-exam-progress-v1'
const FINISHED_KEY = 'manosaba-exam-finished-v1'

interface StoredProgress {
  version: 1
  hash: string
  snapshot: ExamSnapshot
}

export function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'yes'
  } catch {
    return false
  }
}

export function setConsent(granted: boolean): void {
  try {
    if (granted) localStorage.setItem(CONSENT_KEY, 'yes')
    else localStorage.removeItem(CONSENT_KEY)
  } catch {
    /* localStorage disabled — proceed in-memory */
  }
}

/*
 * The spoiler gate's answer (design spec §3.7). Its own key, like consent:
 * NOT content-hash gated (finishing the game survives content releases) and
 * NEVER part of the engine snapshot — it must not touch TAG resolution.
 * 'yes' persists and skips the question on later runs; 'no' re-asks.
 */
export function getFinished(): 'yes' | 'no' | null {
  try {
    const v = localStorage.getItem(FINISHED_KEY)
    return v === 'yes' || v === 'no' ? v : null
  } catch {
    return null
  }
}

export function setFinished(finished: boolean): void {
  try {
    localStorage.setItem(FINISHED_KEY, finished ? 'yes' : 'no')
  } catch {
    /* localStorage disabled — proceed in-memory */
  }
}

/* contentHash comes in as a parameter (the island receives it as a prop) so
 * this module never imports the content layer — keeping the card-globbing
 * content.ts out of the client bundle graph is structural, not tree-shaking. */
export function saveProgress(snapshot: ExamSnapshot, contentHash: string): void {
  try {
    const payload: StoredProgress = { version: 1, hash: contentHash, snapshot }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(payload))
  } catch {
    /* quota / disabled — silent */
  }
}

export function loadProgress(contentHash: string): ExamSnapshot | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredProgress
    if (parsed?.version !== 1 || parsed.hash !== contentHash) return null
    if (!parsed.snapshot || !Array.isArray(parsed.snapshot.answers)) return null
    return parsed.snapshot
  } catch {
    return null
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(PROGRESS_KEY)
  } catch {
    /* silent */
  }
}
