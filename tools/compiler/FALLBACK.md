# Total cell-coverage & the fallback redirect map

*Owner: `tools/compiler/`. Implemented in `src/coverage.ts`, emitted into
`content/quiz/picksets.json` (`redirect`), enforced on every compile.*

## Why total coverage is a soft-launch invariant

The examination scores a visitor onto one of the **8 origin families × 25 coping
styles = 200 grid cells** (the two axes resolve independently, so every cell is
reachable by the scorer — none are "impossible"). But under a partial corpus only
a handful of cells have a shipped card. The runtime session
(`packages/engine/src/session.ts` → `tail()`) resolves a scored cell to a served
card as:

```
landedKey = picksets.redirect[rawCell] ?? rawCell
pickset   = picksets.cells[landedKey]   // throws "uncovered soft-launch cell" if absent
```

`picksets.cells` only ever holds **shipped** cells (cells with ≥1 authored card).
So a session reaches a card only when the scored cell is itself shipped, **or**
the redirect map routes it to a shipped cell. The earlier emission shipped only
the 15 authorial §3 THIN-cell routes — most of whose targets were themselves
unshipped — so ~94% of walks dead-ended and the session threw / went
inconclusive (verified: 12/200 reference personas reached a card).

Design authority (`witch_card_v2_site_design.md` §5) requires the opposite:
**every cell must resolve deterministically to the nearest shipped tag.** So the
compiler now emits a **total** redirect map: every one of the 200 cells that is
not itself shipped-covered is routed to a shipped cell. Total coverage is an
**invariant** — the compile **hard-fails** if any grid cell cannot reach a
shipped tag (and, trivially, if the ship list yields zero shipped cells).

Cross-cell serving is marked: when a redirect fires, the engine sets
`ExamResult.redirectedCell`, so the UI can show the quiet archival note ("this
archive is still being transcribed").

## The tier ranking (nearest shipped cell)

For a non-shipped cell `(family F, style S)` with coping stance `St = stance(S)`,
each shipped cell `(F', S')` is ranked, best first:

| Tier | Condition | Within-tier order |
|---|---|---|
| **1** | same family `F' = F` **and** same stance `stance(S') = St` | coping file-index adjacency `|idx(S') − idx(S)|`, then manifest order |
| **2** | same family `F' = F` (any stance) | coping file-index adjacency, then manifest order |
| **3** | same stance `stance(S') = St` (any family) | **nearest family** `|idx(F') − idx(F)|` first, then coping adjacency, then manifest order |
| **4** | neither — **global default** | highest **density** (most authored tags) first, then manifest order |

- **Coping file-index / family-index adjacency** = distance in the *frozen
  taxonomy listing order* (`src/taxonomy.ts`: `STYLE_NAME_TO_CODE` /
  `FAMILY_NAME_TO_CODE` key order), the same freeze order used elsewhere.
- **Manifest order** (tie-break) = a shipped cell's fixed position, taken as the
  minimum tag manifest-index of its cards (the sorted-tag order in the manifest).
- **Global default** (tier 4) is reached only by cells whose family has no
  shipped cell *and* whose stance matches no shipped cell; it is always the
  single densest shipped cell (currently `ED|Performer`, 4 tags).

**Authorial intent is preserved.** A §3 THIN-cell route
(`authoring_manifest.md §3`, parsed by `src/manifest.ts`) is kept verbatim **iff
its target is a shipped cell** — it then counts as a *manifest-redirect*, not a
computed fallback. Otherwise the source cell is re-routed by the tiers above.

Within a shipped cell, the served *tag* (which of the cell's authored
sub-variant cards) is chosen by the separate per-cell tier algorithm in
`packages/engine/src/tags.ts` (`resolveTag`, tiers 0–3), precomputed into
`content/quiz/neighbor.json`. The two mechanisms compose: the cell-level redirect
picks the cell; the neighbor table picks the tag inside it.

## It self-heals as the ship list grows

The map is **recomputed from `content/ship_list.json` on every compile** — it is
never hand-maintained. Shipping more cards:

- turns more cells into **direct** (shipped) cells → they drop out of the
  redirect map (no entry; resolve to themselves, no `redirectedCell`);
- makes more §3 authorial routes **retainable** (their targets become shipped);
- shrinks every fallback tier and improves the average routing distance.

So the redirect map monotonically shrinks and improves toward the full corpus,
with **no code changes** — author in the workspace, move the tag into
`ship_list.json`, recompile.

## Verification

- `npm run compile` — prints direct / manifest-redirect / fallback-redirect
  counts and the per-tier (1–4) fallback distribution; fails if coverage is not
  total.
- `npm run verify` / `npm run verify:session` — determinism / round-trip intact
  (the redirect map does not change any already-passing K/O resolution or hash).
- `npm run verify:personas` — replays all 200 reference personas through the
  public session against the recompiled content; asserts **200/200 reach a
  shipped tag**, reports the `redirectedCell` count, proves determinism (two
  identical passes), and spot-checks one persona per origin family.

### Current state (7-card ship list: `ED|Performer`, `ABN|Clinger`, `MB|Depender`, `VC|Watcher`)

| Category | Count |
|---|---|
| direct (shipped-covered) | 4 |
| manifest-redirect (§3) | 0 |
| fallback tier 1 (same family + stance) | 11 |
| fallback tier 2 (same family) | 85 |
| fallback tier 3 (same stance, nearest family) | 44 |
| fallback tier 4 (global default / density) | 56 |
| **total** | **200** |

Persona replay: **200/200** reach a shipped tag; **188** carry `redirectedCell`
(12 score directly onto a shipped cell); deterministic across two passes; all 8
families represented.

*(No cell was special-cased: the manifest marks no cell as non-cell / incoherent
— "impossible" appears only in prose card descriptions — and both axes are
independently reachable, so all 200 cells are valid scorer outputs.)*
