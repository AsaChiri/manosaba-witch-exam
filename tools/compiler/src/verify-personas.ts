#!/usr/bin/env -S npx tsx
/**
 * Total-coverage verification (design spec §5). Replays all 200 reference
 * personas through the PUBLIC session against the RECOMPILED content package and
 * asserts the soft-launch coverage invariant: every persona reaches a shipped
 * tag (no dead-end / inconclusive session), regardless of which of the 200 grid
 * cells it scored into.
 *
 * Also:
 *  - counts how many results carry `redirectedCell` (cross-cell archival serving);
 *  - proves determinism by replaying the entire suite twice and asserting the
 *    per-persona (tag, tier, variant, hash, redirect) tuples are identical;
 *  - spot-checks that at least one persona from each of the 8 origin families
 *    lands deterministically on a shipped tag.
 *
 * Exit 0 iff 200/200 reach a shipped tag AND the two passes are identical AND
 * all 8 families are represented; else 1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createExam, type ContentPackage } from "@manosaba/witch-exam-engine";
import { makeSources, DEFAULT_WORKSPACE } from "./sources.js";

function loadJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

interface Persona {
  personaId: string;
  answers: Record<string, string | string[]>;
}
interface Landing {
  personaId: string;
  family: string; // scored origin family
  designFamily: string; // family encoded in the persona id (e.g. ABN-P01 -> ABN)
  tag: string;
  tier: number;
  variant: number;
  redirected: string | null; // landed (served) cell key when cross-cell routed
  hash: string;
}

function loadContent(C: string): ContentPackage {
  const q = (f: string) => loadJson(join(C, "quiz", f));
  return {
    questions: q("questions.json"),
    strings: q("strings.en.json"),
    copingTree: q("tree.coping.json"),
    originBlocks: q("blocks.origin.json"),
    hashSpec: q("hash.spec.json"),
    picksets: q("picksets.json"),
    neighbor: q("neighbor.json"),
    cardsManifest: loadJson(join(C, "cards", "manifest.json")),
  } as unknown as ContentPackage;
}

/** Drive one persona's session to completion, deterministically. */
function drive(content: ContentPackage, persona: Persona): Landing {
  const exam = createExam(content);
  let guard = 0;
  while (!exam.isDone()) {
    if (guard++ > 60) throw new Error(`persona ${persona.personaId}: did not terminate`);
    const cur = exam.current()!;
    const offered = cur.options.map((o) => o.oid);
    const raw = persona.answers[cur.qid];
    let choice: string;
    if (Array.isArray(raw)) {
      // ranking list — first offered option in the ranking, else first offered.
      choice = raw.map(String).find((x) => offered.includes(x)) ?? offered[0]!;
    } else if (typeof raw === "string" && offered.includes(raw)) {
      choice = raw;
    } else {
      // unanswered new-v3 slot / pick screen / filtered fallback: canonical first.
      choice = offered[0]!;
    }
    exam.answer(choice);
  }
  const r = exam.result();
  const m = /^([A-Za-z]+)/.exec(persona.personaId);
  return {
    personaId: persona.personaId,
    family: r.cell.family,
    designFamily: m ? m[1]!.toUpperCase() : "?",
    tag: r.tag,
    tier: r.tier,
    variant: r.variantIndex,
    redirected: r.redirectedCell ? `${r.redirectedCell.family}|${r.redirectedCell.style}` : null,
    hash: `0x${(r.answersHash >>> 0).toString(16).toUpperCase()}`,
  };
}

function replayAll(content: ContentPackage, personas: Persona[]): Landing[] {
  return personas.map((p) => drive(content, p));
}
function key(l: Landing): string {
  return `${l.personaId}|${l.tag}|${l.tier}|${l.variant}|${l.redirected}|${l.hash}`;
}

function main(): void {
  const workspace = process.argv.includes("--workspace")
    ? process.argv[process.argv.indexOf("--workspace") + 1]!
    : DEFAULT_WORKSPACE;
  const src = makeSources(workspace);
  const content = loadContent(src.contentDir);
  const shippedTags = new Set(
    Object.keys((content.cardsManifest as { tags: Record<string, unknown> }).tags),
  );
  // origin-v2 reference personas: coping answers (v1 certified vectors) merged
  // with the N-block origin answers.
  const cells = loadJson<
    { personaId: string; originAnswers: Record<string, string>; copingAnswers: Record<string, string | string[]> }[]
  >(join(src.originV2, "reference_cells.json"));
  const personas: Persona[] = cells.map((c) => ({
    personaId: c.personaId,
    answers: { ...c.copingAnswers, ...c.originAnswers },
  }));

  // Pass 1 + Pass 2 (determinism).
  const pass1 = replayAll(content, personas);
  const pass2 = replayAll(content, personas);

  let reached = 0;
  let redirectedCount = 0;
  const badTag: string[] = [];
  const nonDeterministic: string[] = [];
  const byDesignFamily = new Map<string, Landing>();
  const byScoredFamily = new Set<string>();

  for (let i = 0; i < pass1.length; i++) {
    const l = pass1[i]!;
    const l2 = pass2[i]!;
    if (key(l) !== key(l2)) nonDeterministic.push(l.personaId);
    if (l.tag && shippedTags.has(l.tag)) reached++;
    else badTag.push(`${l.personaId} -> ${l.tag || "(none)"}`);
    if (l.redirected) redirectedCount++;
    byScoredFamily.add(l.family);
    if (!byDesignFamily.has(l.designFamily)) byDesignFamily.set(l.designFamily, l);
  }

  console.log(`persona-session replay (recompiled content):`);
  console.log(`  reached a shipped tag:  ${reached}/${personas.length}`);
  console.log(`  carry redirectedCell:   ${redirectedCount}`);
  console.log(`  direct (no redirect):   ${personas.length - redirectedCount}`);
  console.log(`  determinism (2 passes):  ${nonDeterministic.length === 0 ? "identical" : `DIVERGED (${nonDeterministic.length})`}`);
  console.log("");
  console.log(`  scored origin families represented: ${[...byScoredFamily].sort().join(", ")}`);
  console.log(`  per-family spot-check (design family -> deterministic landing):`);
  for (const fam of [...byDesignFamily.keys()].sort()) {
    const l = byDesignFamily.get(fam)!;
    const via = l.redirected ? `  via ${l.redirected}` : "";
    console.log(`    ${fam.padEnd(4)} ${l.personaId.padEnd(9)} -> ${l.tag} (tier ${l.tier}, v${l.variant})${via}`);
  }
  if (badTag.length) {
    console.log("");
    console.log(`  DEAD-ENDS (${badTag.length}): ${badTag.slice(0, 12).join(", ")}${badTag.length > 12 ? " ..." : ""}`);
  }

  const familiesOk = byDesignFamily.size >= 8;
  const ok = reached === personas.length && nonDeterministic.length === 0 && familiesOk;
  console.log("");
  if (ok) {
    console.log(`VERIFY PERSONAS PASS — ${reached}/${personas.length} reach a shipped tag; ${byDesignFamily.size} families; deterministic.`);
    process.exit(0);
  }
  if (!familiesOk) console.log(`  only ${byDesignFamily.size}/8 families represented`);
  console.log("VERIFY PERSONAS FAIL");
  process.exit(1);
}

main();
