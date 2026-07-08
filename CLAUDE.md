# 魔女因子検査 / Witch Factor Examination — site repo

Fan-made web experience for 魔法少女ノ魔女裁判 (Manosaba): the visitor is diegetically *examined for the witch factor*, receives a verdict, and gets their 魔女図鑑 card. This is the **v2 runtime** of the witch-card project; all content (quiz banks, card corpus) is authored in the workspace repo `D:\Manosaba_Script_Project_Workspace` and compiled into this repo as data.

**Design authority:** `D:\Manosaba_Script_Project_Workspace\output\witch_card_v2_site_design.md` — palette, typography, motifs, screens, copy register, contracts. Do not diverge without updating it.
**Model/plan authority:** `witch_card_v2_model_spec.md` + `witch_card_v2_execution_plan.md` (same dir).

## Layout

```
/                      Astro 5 + Vue 3 islands app (root workspace)
packages/engine/       @manosaba/engine — deterministic 16-phase quiz scorer (TS port,
                       verified 200/200 vs the certified Python reference in the workspace)
tools/compiler/        compile-content CLI: workspace markdown → content/ JSON
content/               THE compiled content package (committed; reviewable diffs)
  ship_list.json       ← the ship-readiness allowlist (see workflow below)
  meta.json            contentVersion drives localStorage invalidation
  quiz/                89-slot questions, trees, picksets, neighbor, hash spec, strings
  cards/<TAG>.<loc>.json  card content, TAG = origin-sv_coping-sv (e.g. ED-1_PE-1)
scripts/generate-og.ts OG PNG generation (worker pool, content-hash incremental)
src/                   app: pages (4 locales), exam island, share, i18n catalogs, styles
```

Key seams:
- `src/lib/engine.ts` — the ONE module choosing the active engine (real `@manosaba/engine` vs `mock-engine.ts` dev fallback).
- `src/lib/content.ts` + `content-schema.ts` — zod raw-schema + normalize layer; UI components only see normalized `Card`.
- `src/i18n/*.json` — UI-chrome strings, one flat catalog per locale (zh-CN authoritative for tone; zh-TW derived manually). Question text comes from `content/quiz/strings.<locale>.json` (EN structural drafts until the Phase-3 gate passes).

## Commands

```bash
npm install            # links workspaces (engine must build before app/compiler use it)
npm run dev            # Vite/Astro dev server
npm run build          # gen:og → astro check → astro build (static, dist/)
npm -w @manosaba/engine test        # 13 tests incl. 200-persona replay — must stay green
npm -C tools/compiler run compile   # recompile content/ from the workspace
npm -C tools/compiler run verify    # round-trip: compiled trees reproduce certified outputs
```

## Content update workflow (the whole maintenance loop)

1. Author/repair cards or quiz text in the **workspace** (never edit `content/` by hand).
2. Owner reviews a card in zh-CN → move its tag from `pendingReview` to `shipped` in `content/ship_list.json`.
3. `npm -C tools/compiler run compile` → review the `content/` git diff.
4. `npm run build` (regenerates OG only for changed tags) → deploy `dist/`.

Post-Phase-3-gate quiz swap is the same loop: the validated bank recompiles into `content/quiz/`; `meta.json.contentVersion` changes, which auto-invalidates visitors' saved in-progress state.

## Env / phases

`.env` (see `.env.example`): `PUBLIC_SITE_PHASE=soft|launch` (soft shows the archival line + prominent feedback), `PUBLIC_FEEDBACK_EMAIL` (dedicated alias — never a personal inbox), `PUBLIC_SITE_URL`, `PUBLIC_BEACON_URL` (unset = beacon no-op).

## Soft-launch checklist (quiet public launch, ~1–2 weeks, no promo)

- [ ] Phase-3 accuracy gate passed & validated bank compiled (quiz is DRAFT until then)
- [ ] ship_list has the reviewed corpus; compile report coverage acceptable
- [ ] `PUBLIC_FEEDBACK_EMAIL` set to a provisioned alias; test the mailto on desktop+mobile
- [ ] Domain chosen; `PUBLIC_SITE_URL` + share URLs verified; OG unfurls tested (Weibo/QQ/X/Discord)
- [ ] Beacon Worker + KV deployed; `PUBLIC_BEACON_URL` set; 4 events verified aggregate-only
- [ ] `PUBLIC_SITE_PHASE=soft`; safety gate + crisis links re-verified per locale
- [ ] Share PNG export tested on real iOS + WeChat in-app browser (long-press save path)

## Hard rules

- Determinism: no `Date.now`/`Math.random` in any resolution path; engine tests are the tripwire.
- Color discipline: cyan = examination only, violet = verdict/card only, gold = seals/ornament, pink = the one CTA. Never mix glows on a screen except the verdict transition.
- Safety text (18+, content notice, crisis links) stays plain-language and out-of-world — diegesis never dilutes it.
- The card page share surface stays near-zero-JS; per-card content is data, never hardcoded.
- Game assets are inspiration only (palette/motifs rebuilt as SVG/CSS); no ripped images shipped without an explicit owner decision (design doc §9).
