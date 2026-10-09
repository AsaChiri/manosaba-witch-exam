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

Use Node.js 22 (22.14.0 tested) and npm 10. Run commands from the repository
root so npm links the engine and compiler workspaces:

```bash
git clone https://github.com/AsaChiri/manosaba-witch-exam.git
cd manosaba-witch-exam
npm ci               # install the locked dependencies and link workspaces
npm run dev          # build engine + generate fonts + start dev server
```

Open the local URL printed by Astro (normally `http://localhost:4321`).
`npm start` is an alias for the same development setup. The committed
`content/` and game assets are sufficient for ordinary site development;
the external authoring workspace is not required.

The first font/OG generation may download full fonts from
`raw.githubusercontent.com` into `scripts/.fonts-cache/`, so allow network
access. The optional `D:/Monosaba Personality Test/scripts/fonts-full` cache
is only a shortcut; missing fonts are downloaded automatically.

```bash
npm run build:engine # compile packages/engine/dist/ explicitly when needed
npm run gen:fonts    # regenerate local font subsets and their CSS
npm run gen:og       # regenerate OG images + robots.txt (worker pool, hash-skip)
npm run check        # build engine + astro check (types + templates)
npm run typecheck:vue # build engine + vue-tsc over the island components
npm run build        # engine + fonts + OG + astro check + astro build
npm run build:fast   # engine + fonts + astro build (skips OG + check)
npm run preview      # serve dist/
```

The engine package exports generated files under `packages/engine/dist/`,
which are not committed. `dev`, `start`, `check`, `typecheck:vue`, `build` and
`build:fast` build it automatically before use. After editing engine source
while the dev server is running,
rerun `npm run build:engine` (or restart `npm run dev`).

`npm run build` must complete cleanly before previewing or deploying. It
generates the static site for all four locales, including card/character
pages, data endpoints, 404 and sitemap. `build:fast` is for local iteration;
it does not regenerate OG images or run checks.

### Engine tests

```bash
npm test --workspace @manosaba/witch-exam-engine
npm run typecheck --workspace @manosaba/witch-exam-engine
```

The deterministic scorer, session and certification tests use committed
fixtures in `packages/engine/test/fixtures/`; they do not require the external
authoring workspace. Run these plus `npm run check`, `npm run typecheck:vue`
and `npm run build` when changing engine integration.

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

**Colour is the information structure** (design spec §2.1, revised 2026-09-02
to the game's red-and-black identity): ember (`--exam-ember`) lives only inside
the examination instrument, blood-red (`--witch-red`) owns the verdict + card,
gold is seals/ornament only, and the hot-pink CTA is the single loudest element.

### Quiz engine seam

The whole flow drives against `src/lib/engine-api.ts`. By default,
`src/lib/engine.ts` uses the real deterministic `@manosaba/witch-exam-engine`
from `packages/engine`, wired to compiled quiz content through
`src/lib/exam-adapter.ts`.

For the development mock, set `PUBLIC_USE_MOCK_ENGINE=1` (or `true`) in `.env`
and restart the dev server. Unset it to return to the real engine. This is a
build-time switch; leave it unset for production. The engine package still
needs to be built in mock mode because the real adapter is statically imported.

### Content contract

The site never hardcodes card content. It consumes the compiled package under
`content/` when present, else the fixtures under `src/fixtures/`. Quiz structure,
card routing, cards, and characters are compiler-owned. The four
`content/quiz/strings.<locale>.json` files are authoritative source in this repo
and are never regenerated. On-disk cards are the raw shape
(`variants[].fields`, `magic` as a string, `cell` = `"FAMILY|Style"`);
`lib/content.ts` validates with zod and normalizes to the UI-facing `Card`.

**Update workflow:** author cards/characters in the workspace → compile
`content/` → review the diff → `npm run build` (regenerates OG + pages for new
tags) → deploy. Adding cards automatically rebuilds picksets, neighbor tables,
redirect coverage, variant counts, and result pages; no code change is required.
Question/choice wording is maintained directly in the four quiz-string files.

### Optional content-authoring tools

The workflow above is for maintainers with the separate
`D:/Manosaba_Script_Project_Workspace` source workspace, which also holds
the design/model documents referenced here and in `CLAUDE.md`. It is not
included in this repository. Normal site work uses the committed `content/`
without recompiling it.

With that workspace available, build the engine first, then compile and
verify authored content (replace the path if your workspace is elsewhere):

```bash
npm run build:engine
npm run compile --workspace @manosaba/witch-exam-compiler -- --workspace "D:/Manosaba_Script_Project_Workspace"
npm run verify --workspace @manosaba/witch-exam-compiler -- --workspace "D:/Manosaba_Script_Project_Workspace"
```

The compiler's `verify:session` and `verify:personas` commands also read
certified reference data from that external workspace and accept the same
`--workspace` argument. These are separate from the self-contained engine
tests above. Review generated `content/` changes before building the site;
the compiler preserves the four authoritative quiz-string files.

`npm run import:assets` is a separate, optional maintainer operation. It
reads an AssetRipper export from `MANOSABA_ASSETS_DIR` or
`D:/AssetRipper_win_x64/manosaba/Assets`. The allowed imported assets are
already committed; ordinary setup does not need to run this command.

## Environment

Copy `.env.example` → `.env`:

- `PUBLIC_SITE_URL` — canonical origin (drives canonicals, hreflang, OG, share).
- `PUBLIC_FEEDBACK_EMAIL` — **TODO(owner):** provision a dedicated alias. The
  placeholder `witch-exam-feedback@asachiri.com` is intentionally invalid.
- `PUBLIC_V1_URL` — footer link to the author's prior personality test; unset ⇒
  the built-in default (`manosaba-test.asachiri.com`).
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
