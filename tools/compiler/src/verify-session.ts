#!/usr/bin/env -S npx tsx
/**
 * End-to-end smoke on the REAL compiled content: load the full package, pick a
 * persona that lands on an authored cell, drive the public session to a served
 * card, and print the result. Proves picksets/neighbor/strings + the pick tail
 * all wire together at runtime.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createExam, type ContentPackage } from "@manosaba/witch-exam-engine";
import { makeSources, DEFAULT_WORKSPACE } from "./sources.js";

function loadJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function main(): void {
  const workspace = process.argv.includes("--workspace")
    ? process.argv[process.argv.indexOf("--workspace") + 1]!
    : DEFAULT_WORKSPACE;
  const src = makeSources(workspace);
  const C = src.contentDir;
  const q = (f: string) => loadJson(join(C, "quiz", f));
  const content = {
    questions: q("questions.json"),
    strings: q("strings.en.json"),
    copingTree: q("tree.coping.json"),
    originTree: q("tree.origin.json"),
    hashSpec: q("hash.spec.json"),
    picksets: q("picksets.json"),
    neighbor: q("neighbor.json"),
    cardsManifest: loadJson(join(C, "cards", "manifest.json")),
  } as unknown as ContentPackage;

  // find a persona whose reference cell is an authored cell
  const scored = loadJson<{ personaId: string; cell: [string, string] }[]>(
    join(src.scorer, "scored_r2.json"),
  );
  const authored = new Set(Object.keys((content.picksets as { cells: object }).cells));
  const target = scored.find((r) => authored.has(`${r.cell[0]}|${r.cell[1]}`));
  if (!target) {
    console.log("no persona lands on an authored cell (expected on a tiny ship list)");
    return;
  }
  const persona = loadJson<{ personaId: string; answers: Record<string, string | string[]> }[]>(
    join(src.scorer, "all_answers.json"),
  ).find((p) => p.personaId === target.personaId)!;

  const exam = createExam(content);
  const asked: string[] = [];
  let guard = 0;
  while (!exam.isDone()) {
    if (guard++ > 40) throw new Error("did not terminate");
    const cur = exam.current()!;
    const offered = cur.options.map((o) => o.oid);
    const raw = persona.answers[cur.qid];
    let choice: string;
    if (Array.isArray(raw)) choice = raw.find((x) => offered.includes(String(x))) ?? offered[0]!;
    else if (typeof raw === "string" && offered.includes(raw)) choice = raw;
    else choice = offered[0]!; // pick screens + filtered fallbacks
    asked.push(`${cur.qid}:${choice}`);
    exam.answer(choice);
  }
  const r = exam.result();
  console.log(`persona ${persona.personaId} -> cell ${r.cell.family} x ${r.cell.style}`);
  console.log(`  path (${asked.length}): ${asked.join(" ")}`);
  console.log(`  picks: o=${r.picks.o} c=${r.picks.c}  served tag: ${r.tag} (tier ${r.tier}, variant ${r.variantIndex})`);
  console.log(`  answersHash: 0x${(r.answersHash >>> 0).toString(16).toUpperCase()}  (${new TextEncoder().encode(r.canonicalString).length} bytes)`);
  console.log("SESSION SMOKE PASS");
}

main();
