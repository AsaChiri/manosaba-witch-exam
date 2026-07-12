/*
 * Build-time assembly of the real engine's ContentPackage from the compiled
 * `content/quiz/*` + `content/cards/manifest.json` artifacts.
 *
 * PAYLOAD DECISION — build-time import into the island bundle (vs runtime fetch
 * from public/). This module is imported only by engine.ts, which is imported
 * only by the `client:only` ExamIsland. So the ~140KB of quiz JSON (rule tables
 * + one EN locale of structural-draft strings) lands ONLY in the /exam/ route's
 * island chunk. The landing (`/`) and card share pages (`/r/<tag>/`) never
 * import the island, so they stay JS-light / zero-JS-ish — the design's hard
 * constraint ("only /exam/ needs the quiz payload") is satisfied purely by the
 * island being route-scoped.
 *
 * Tradeoff: the /exam/ island chunk carries the quiz payload up front (no async
 * boundary in the synchronous createExam path, no copy step, deterministic,
 * offline-clean — but the exam route's initial JS is larger). If post-consent
 * laziness is later wanted, switch these eager globs to
 * `import.meta.glob(..., { eager: false })` loaders behind an async session
 * factory; the consent gate already renders before the session is created.
 *
 * The globs mirror content.ts (root-relative `/content/...`), so no per-file TS
 * module resolution is needed and the pattern stays consistent with the rest of
 * the content layer.
 */
import type { ContentPackage } from '@manosaba/witch-exam-engine'

const quizModules = import.meta.glob<{ default: unknown }>('/content/quiz/*.json', {
  eager: true,
})
const manifestModules = import.meta.glob<{ default: unknown }>(
  '/content/cards/manifest.json',
  { eager: true },
)

function byName(
  mods: Record<string, { default: unknown }>,
  name: string,
): unknown {
  for (const [path, mod] of Object.entries(mods)) {
    if (path.endsWith(`/${name}`)) return mod.default
  }
  throw new Error(`quiz-content: missing compiled artifact ${name}`)
}

/**
 * The engine's runtime content package. Only the fields the session driver
 * touches are populated (questions/strings power the UI; the trees + hashSpec
 * power resolution; picksets + neighbor power the pick tail; cardsManifest is
 * carried for completeness). The engine does not validate on load, so a plain
 * object matching ContentPackage is accepted; the shapes are the compiler's
 * zod-checked output.
 */
/**
 * Per-locale display strings. Every compiled `strings.<loc>.json` is loaded and
 * merged OVER the en base, so any qid a locale has not authored yet (e.g. the
 * V.* pick-tail screens, currently en-only) falls back to English rather than
 * showing a raw key. Keyed by locale; `en` is the base. Selected at session
 * creation by the island's locale (see exam-adapter.makeRealCreateExam).
 */
function buildStringsByLocale(): Record<string, unknown> {
  const en = byName(quizModules, 'strings.en.json') as {
    locale: string
    questions: Record<string, unknown>
  }
  const out: Record<string, unknown> = { en }
  for (const [path, mod] of Object.entries(quizModules)) {
    const m = /\/strings\.([\w-]+)\.json$/.exec(path)
    if (!m || m[1] === 'en') continue
    const loc = m[1]!
    const s = mod.default as { questions: Record<string, unknown> }
    out[loc] = { locale: loc, questions: { ...en.questions, ...s.questions } }
  }
  return out
}

export const QUIZ_STRINGS_BY_LOCALE = buildStringsByLocale() as unknown as Record<
  string,
  ContentPackage['strings']
>

export const QUIZ_CONTENT = {
  questions: byName(quizModules, 'questions.json'),
  strings: byName(quizModules, 'strings.en.json'),
  copingTree: byName(quizModules, 'tree.coping.json'),
  originBlocks: byName(quizModules, 'blocks.origin.json'),
  hashSpec: byName(quizModules, 'hash.spec.json'),
  picksets: byName(quizModules, 'picksets.json'),
  neighbor: byName(quizModules, 'neighbor.json'),
  cardsManifest: byName(manifestModules, 'manifest.json'),
} as unknown as ContentPackage
