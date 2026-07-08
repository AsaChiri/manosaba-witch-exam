# 魔女因子検査 — Witch Factor Examination

A fan-made, non-commercial **diegetic examination site** for *魔法少女ノ魔女裁判*
(Magical Girl · Witch Trial). The visitor is not "taking a quiz" — they are
**examined for the witch factor**: the instrument reads their responses, the
court pronounces a verdict, and the archive returns their page in the 魔女図鑑
(the witch they became on the island).

The design authority is `output/witch_card_v2_site_design.md` in the workspace.

## Stack

- **Astro 5** (static output) + **Vue 3** islands + **TypeScript** (strict)
- `@astrojs/vue`, `@astrojs/sitemap`
- Self-hosted fonts via `@fontsource/*` (unicode-range woff2 — solves the
  GFW/self-host problem for the zh-CN audience)
- Content validated with **zod**; OG images rendered with **resvg-js**
- Target deploy: **Cloudflare Pages** (`public/_headers`, themed `404`)

## Commands

```bash
npm install
npm run dev          # dev server
npm run gen:og       # regenerate OG images + robots.txt (worker pool, hash-skip)
npm run check        # astro check (types + templates)
npm run typecheck:vue# vue-tsc over the island components
npm run build        # gen:og → astro check → astro build  (the release build)
npm run build:fast   # astro build only (skips OG + check)
npm run preview      # serve dist/
```

`npm run build` must complete cleanly. The build writes ~37 static pages
(4 locales × landing + exam + N card pages, plus 404 + sitemap).

## Architecture

```
src/
  styles/         tokens.css (palette §2.1) · fonts-*.css (per-locale) · global.css · witch-card.css
  components/      Seal.astro (the signature crest) · CardFrame · WitchCard · SEOHead · Footer ·
                  LocaleSwitcher · CtaButton (pink torn-paper) · Feedback · SafetyNote · LangSuggestBanner
  components/exam/ ExamIsland.vue (client:only) + ConsentGate · QuizRunner · NamePrompt ·
                  VerdictSequence · ResultView · ShareRow · Seal.vue
  layouts/        BaseLayout.astro
  views/          Landing · ExamPage · CardPage (shared per-locale views)
  pages/          index · exam/ · r/[tag] · 404  (+ en/ ja/ zh-tw/ mirrors)
  lib/            engine-api · engine (swap point) · mock-engine · content · content-schema ·
                  share · storage · sanitize · beacon
  i18n/           config.ts · index.ts (t helper) · {zh-CN,en,ja,zh-TW}.json
  fixtures/       raw-shape fallback content (2 cards) used when content/ is absent
scripts/          generate-og.ts + og-worker.mjs
public/           _headers · robots.txt · favicon.svg · og/ (generated)
```

**Colour is the information structure** (design spec §2.1): cyan lives only
inside the examination instrument, violet owns the verdict + card, gold is
seals/ornament only, and the hot-pink CTA is the single loudest element.

### Quiz engine seam

The whole flow drives against `src/lib/engine-api.ts`. Today
`src/lib/engine.ts` re-exports the deterministic `MockEngine`. When the real
`@manosaba/engine` (from `packages/engine`) lands, swap **one line** in
`engine.ts`.

### Content contract

The site never hardcodes card content. It consumes the compiled package under
`content/` (owned by the sibling compiler; **read-only**) when present, else the
fixtures under `src/fixtures/`. On-disk cards are the raw shape
(`variants[].fields`, `magic` as a string, `cell` = `"FAMILY|Style"`);
`lib/content.ts` validates with zod and normalizes to the UI-facing `Card`.

**Update workflow:** author in workspace → compile `content/` → review the diff →
`npm run build` (regenerates OG + pages for new tags) → deploy. Adding cards
requires no code change.

## Environment

Copy `.env.example` → `.env`:

- `PUBLIC_SITE_URL` — canonical origin (drives canonicals, hreflang, OG, share).
- `PUBLIC_SITE_PHASE` — `soft` (archival line + prominent feedback) | `launch`.
- `PUBLIC_FEEDBACK_EMAIL` — **TODO(owner):** provision a dedicated alias. The
  placeholder `feedback@example.invalid` is intentionally invalid.
- `PUBLIC_BEACON_URL` — aggregate telemetry endpoint; unset ⇒ console no-op.

## Deploy notes (Cloudflare Pages)

- Build command `npm run build`, output `dist/`.
- `public/_headers` sets immutable cache on hashed `/_astro/*` + fonts, a short
  edge cache on `/og/*`, and security headers.
- Set `PUBLIC_SITE_URL` to the production origin so `gen:og` rewrites
  `robots.txt`'s sitemap URL and every canonical/OG URL is correct.

## Disclaimer

Non-commercial fan work, unaffiliated with the original and its rights holders.
The previous personality test lives at <https://manosaba-test.asachiri.com>.
