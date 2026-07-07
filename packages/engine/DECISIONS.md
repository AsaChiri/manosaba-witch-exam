# Engine DECISIONS — deviations, resolutions, and load-bearing choices

This package is the determinism layer of the product. Every judgment call is
recorded here. The contract is `decision_tree_scorer_spec.md` (v0.5, Appendix A
v3); the byte-level oracle is the certified Python reference
`validation/scorer/scorer.py` + its data tables and outputs (`scored_r2.json`,
`certification.md`). Where the prose spec and the certified code could be read to
disagree, **the certified code wins** — it is what produced the frozen
`scored_r2.json` the engine is contractually required to reproduce.

## D1. Tree representation: rule tables + evaluator (not an enumerated trie)

Spec §6 sketches `tree.coping.json` as a "literal transition table" and
`tree.origin.json` as "rule constants + a ~100-line deterministic evaluator".
Spec §2.4 explicitly sanctions **both** representations ("Same function, two
representations"). We ship the *rule-tables + evaluator* form for **both** axes:
`tree.coping.json` mirrors the certified `questions_k.json`, `tree.origin.json`
mirrors `questions_o.json` + `prior.json`. The evaluator (`resolver.ts`) is a
1:1 port of `scorer.py`.

Rationale: the rule tables are the certified data; the evaluator is provably
equivalent to the reference (200/200 persona replay + 32/32 certification
checks). A hand-enumerated transition trie would be a second, unverified
artifact. This is a representation choice, not a semantic deviation.

## D2. Discriminator fire order follows `scorer.py`, not the stale prose note

`extraction_notes.md`'s "non-ambiguities" list records the *v1* fire order
(leader → gap → P-before-B → num). The **v0.5 spec §2.2.4 and `scorer.py`** both
use: leader-containing first, then **frozen (O.P\*) before boundary (O.B\*)**,
then ascending gap, then ascending bank number. We follow `scorer.py` (and §2.2.4).
`scored_r2.json` — which we reproduce exactly — was produced under this order.

## D3. `new_slot` degradation is a validation-mode concept only

Legacy round-1 answer vectors lack the seven v3 slots (K.P17–K.P21, O.R3,
O.P4b). The reference degrades them (guard→confirm, router/alternate→no-vote,
resolver→block-tiebreak-else-abstain) and flags `missing_new_slot:*`. This is
correct **only** for full-map scoring of a complete-but-legacy vector.

In **session (runtime) mode** every slot is asked as the machine reaches it, so
degradation is disabled (`Walker.degrade()` returns false unless `mode==="full"`).
A fresh runtime collection never produces these flags. The two modes share one
walk; the only difference is how a missing answer is interpreted: full mode →
degrade/error; session mode → `Pending` (present the question).

## D4. Filtered-question semantics (K.R4 + tie-breaks)

Reproduced exactly from the reference: `consume()`'s `allowed` set constrains
only **ranking-list** answers (the recommended fresh-collection form); a bare
single-letter answer is validated against the full option set and the *caller*
enforces the display filter (out-of-display → abstain/redirect + `filter_violation`
flag). In session mode the UI only ever offers displayed options, so these
degradation paths are unreachable at runtime.

## D5. Pick-screen hash tokens (spec §4.2 / §4.4)

A pick screen that is **shown and answered** tokenizes as `V.OPICK:<id>` /
`V.CPICK:<id>` / `V.OGROUP:<gid>`. A screen that is **auto-assigned / skipped**
(single covered sub-variant, or a group screen that doesn't fire) contributes the
**sentinel `X`** to the canonical string — even though the auto-assigned id still
drives tag resolution. The session tracks `oShown` / `cShown` / `groupFired` to
apply this split. Verified: the §4.5 worked example (both picks shown, group not
fired) reproduces `0x46A43834` over 665 bytes through the full session path.

## D6. `back()` = single-step undo only

Per the task's "keep it simple; no back across committed phases": `back()` undoes
the most recent committed answer (re-opening that question). There is no
multi-step history and no phase-rewind. `canGoBack()` is true whenever ≥1 answer
has been committed. Re-running the pure walk after an undo yields the exact state
as if that answer had never been given.

## D7. Session recomputation strategy

The session re-runs the entire hard-axes walk (`Walker`, session mode) after each
answer, catching `Pending` to find the next question. The walk is pure and
bounded (≤22 slots), so this is O(1) for practical purposes and removes any risk
of session/validation divergence — they are literally the same code path.

## D8. Canonical keys

Internal composite keys use `|` as separator (`cellKey = family|style`,
`pickPairKey = originSub|copingSub`, pair/shadow lookup keys). No family code,
style name, stance, or sub-variant id contains `|`, so the keys are unambiguous.
`prePickString` (the §4.6 permutation seed) is the canonical serialization
restricted to the `K.*` and `O.*` slots.

## D9. Both retired hash pins are reproduced

Only v3 (`0x46A43834`) is live. The engine test also reproduces the retired v2
(`0x6FC8FE2D`, 610 B) and v1 (`0xF6ADEE5B`, 599 B) pins from `certification.md`
§3 as independent FNV-1a correctness vectors over different inputs. v1/v2/v3 are
not comparable and nothing shipped under v1/v2.

## D10. Determinism guarantees

No `Date.now` / `Math.random` anywhere in `src/`. The §4.6 display permutation is
a pure function of the answer prefix (xorshift32 + Fisher–Yates seeded from
FNV-1a). `zod` is the sole runtime dependency.
