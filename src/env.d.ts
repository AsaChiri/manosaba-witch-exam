/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Canonical site origin (no trailing slash). Drives canonicals/OG/share. */
  readonly PUBLIC_SITE_URL?: string
  /** Trusted zh-CN share landing (full URL, e.g. the bilibili mirror entry).
   *  When set, zh-CN copy-share links and export QRs point here (+`?r=<tag>`)
   *  instead of the canonical card page. Unset → canonical `/r/<tag>/`. */
  readonly PUBLIC_SHARE_URL_ZH_CN?: string
  /** Feedback alias, e.g. `manosaba.exam@…`. Placeholder in .env.example. */
  readonly PUBLIC_FEEDBACK_EMAIL?: string
  /** The author's previous personality test — linked in the footer. Unset →
   *  the built-in default (manosaba-test.asachiri.com). */
  readonly PUBLIC_V1_URL?: string
  /** Aggregate-telemetry endpoint. Absent → beacon is a console.debug no-op. */
  readonly PUBLIC_BEACON_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
