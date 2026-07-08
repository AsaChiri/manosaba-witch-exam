/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Canonical site origin (no trailing slash). Drives canonicals/OG/share. */
  readonly PUBLIC_SITE_URL?: string
  /** `soft` shows the archival line + prominent feedback; `launch` is quiet. */
  readonly PUBLIC_SITE_PHASE?: 'soft' | 'launch'
  /** Feedback alias, e.g. `manosaba.exam@…`. Placeholder in .env.example. */
  readonly PUBLIC_FEEDBACK_EMAIL?: string
  /** Aggregate-telemetry endpoint. Absent → beacon is a console.debug no-op. */
  readonly PUBLIC_BEACON_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
