/*
 * The active quiz engine (design spec §4). Production path = the REAL
 * deterministic scorer `@manosaba/witch-exam-engine` (packages/engine), wrapped
 * in a thin site-side adapter (exam-adapter.ts) so the whole UI keeps driving
 * against engine-api.ts. This module only wires the adapter to the compiled
 * QUIZ_CONTENT and chooses real-vs-mock, so the swap stays a one-file concern.
 *
 * mock-engine.ts stays in-tree as a dev fallback (PUBLIC_USE_MOCK_ENGINE=1).
 */
import type { CreateExam } from './engine-api'
import { QUIZ_CONTENT, QUIZ_STRINGS_BY_LOCALE } from './quiz-content'
import { makeRealCreateExam } from './exam-adapter'
import { createExam as createMockExam } from './mock-engine'

const createRealAdapter: CreateExam = makeRealCreateExam(
  QUIZ_CONTENT,
  QUIZ_STRINGS_BY_LOCALE,
)

// Dev escape hatch: PUBLIC_USE_MOCK_ENGINE=1 falls back to the in-tree mock.
// Folds to a constant at build time, so the mock is tree-shaken from prod.
const USE_MOCK =
  import.meta.env.PUBLIC_USE_MOCK_ENGINE === '1' ||
  import.meta.env.PUBLIC_USE_MOCK_ENGINE === 'true'

export const createExam: CreateExam = USE_MOCK ? createMockExam : createRealAdapter

export type * from './engine-api'
