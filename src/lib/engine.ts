/*
 * The active quiz engine. This is the ONE module to change when the real
 * deterministic scorer ships as `@manosaba/engine` (from packages/engine):
 *
 *   // import { createExam } from '@manosaba/engine'
 *   import { createExam } from './mock-engine'
 *   export { createExam }
 *
 * Everything else drives against engine-api.ts, so the swap is a single line.
 */
export { createExam } from './mock-engine'
export type * from './engine-api'
