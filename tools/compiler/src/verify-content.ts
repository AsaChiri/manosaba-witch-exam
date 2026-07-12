#!/usr/bin/env -S npx tsx
/**
 * Round-trip verification: load the COMPILED content package and prove the
 * engine reproduces the certified references from it:
 *
 *  1. COPING — the 200 blind personas' coping walk must match the certified
 *     scored_r2.json coping fields byte-identically (the origin fields of that
 *     frozen file belong to the retired v1 tree and are no longer compared).
 *  2. ORIGIN v2 — the 200 origin_v2/reference_cells.json personas (coping +
 *     N-block answers) must reproduce EVERY expected field 200/200.
 *
 * Exit 0 on 200/200 + 200/200, else 1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  prepareTrees,
  resolveHardAxes,
  Walker,
  type CopingTree,
  type OriginBlocks,
  type AnswerMap,
} from "@manosaba/witch-exam-engine";
import { makeSources, DEFAULT_WORKSPACE } from "./sources.js";

function loadJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}
function canon(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort())
      o[k] = sortKeys((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

const COPING_FIELDS = [
  "r4Fired",
  "stanceVotes",
  "enteredBlock",
  "shadowStance",
  "coreTally",
  "styleVotes",
  "tieResolver",
  "guard",
  "copingStyle",
  "copingTrueStance",
  "copingConfidence",
  "copingRunnerUp",
  "copingPathLength",
] as const;

const FAMILIES = ["ABN", "ED", "MB", "DEF", "ALN", "FAI", "VC", "POW"];

interface ReferenceCell {
  personaId: string;
  originAnswers: Record<string, string>;
  copingAnswers: AnswerMap;
  expected: {
    originFamily: string;
    originRunnerUp: string;
    originSums: Record<string, number>;
    copingStyle: string;
    copingRunnerUp: string | null;
    copingConfidence: string;
    enteredBlock: string;
    guard: unknown;
    cell: [string, string];
  };
}

function main(): void {
  const workspace = process.argv.includes("--workspace")
    ? process.argv[process.argv.indexOf("--workspace") + 1]!
    : DEFAULT_WORKSPACE;
  const src = makeSources(workspace);
  const C = src.contentDir;

  const coping = loadJson<CopingTree>(join(C, "quiz", "tree.coping.json"));
  const blocks = loadJson<OriginBlocks>(join(C, "quiz", "blocks.origin.json"));
  const prepared = prepareTrees(coping, blocks);

  // 1. coping replay (certified reference, coping fields only)
  const personas = loadJson<{ personaId: string; answers: AnswerMap }[]>(join(src.scorer, "all_answers.json"));
  const expected = loadJson<Record<string, unknown>[]>(join(src.scorer, "scored_r2.json"));
  const byId = new Map(expected.map((r) => [r["personaId"] as string, r]));
  let copingPass = 0;
  const copingFails: string[] = [];
  for (const p of personas) {
    const w = new Walker(prepared, p.personaId, p.answers, "full");
    w.coping();
    const want = byId.get(p.personaId);
    if (!want) {
      copingFails.push(p.personaId);
      continue;
    }
    const got: Record<string, unknown> = {
      r4Fired: w.r4Fired,
      stanceVotes: w.stanceVotes,
      enteredBlock: w.enteredBlock,
      shadowStance: w.shadowStance,
      coreTally: w.coreTally,
      styleVotes: w.styleVotes,
      tieResolver: w.tieResolver,
      guard: w.guard,
      copingStyle: w.copingStyle,
      copingTrueStance: w.copingStance,
      copingConfidence: w.copingConfidence,
      copingRunnerUp: w.copingRunnerUp,
      copingPathLength: w.copingLen,
    };
    const askedWant = (want["askedPath"] as string[]).slice(0, want["copingPathLength"] as number);
    const askedGot = w.asked.map(([q, o]) => (typeof o === "string" ? `${q}:${o}` : `${q}:${o.join("+")}`));
    const flagsWant = (want["flags"] as string[]).filter((f) => !f.includes("O.") && !f.startsWith("c1_"));
    const ok =
      COPING_FIELDS.every((k) => canon(got[k]) === canon(want[k])) &&
      canon(askedGot) === canon(askedWant) &&
      canon(w.flags) === canon(flagsWant);
    if (ok) copingPass++;
    else copingFails.push(p.personaId);
  }

  // 2. origin-v2 parity (reference_cells.json, full mode, every expected field)
  const cells = loadJson<ReferenceCell[]>(join(src.originV2, "reference_cells.json"));
  let originPass = 0;
  const originFails: string[] = [];
  for (const c of cells) {
    const { record } = resolveHardAxes(prepared, c.personaId, {
      ...c.copingAnswers,
      ...c.originAnswers,
    });
    const e = c.expected;
    const sumsOk = FAMILIES.every((f) => (record.originSums[f] ?? 0) === (e.originSums[f] ?? 0));
    const ok =
      record.originFamily === e.originFamily &&
      record.originRunnerUp === e.originRunnerUp &&
      sumsOk &&
      record.copingStyle === e.copingStyle &&
      record.copingRunnerUp === e.copingRunnerUp &&
      record.copingConfidence === e.copingConfidence &&
      record.enteredBlock === e.enteredBlock &&
      canon(record.guard) === canon(e.guard) &&
      record.cell[0] === e.cell[0] &&
      record.cell[1] === e.cell[1];
    if (ok) originPass++;
    else originFails.push(c.personaId);
  }

  console.log(`coping replay (scored_r2 coping fields): ${copingPass}/${personas.length}`);
  console.log(`origin-v2 parity (reference_cells):      ${originPass}/${cells.length}`);
  if (copingFails.length) console.log(`  coping diverged: ${copingFails.slice(0, 10).join(", ")}${copingFails.length > 10 ? " ..." : ""}`);
  if (originFails.length) console.log(`  origin diverged: ${originFails.slice(0, 10).join(", ")}${originFails.length > 10 ? " ..." : ""}`);

  if (copingPass === personas.length && originPass === cells.length) {
    console.log("VERIFY PASS — compiled content reproduces the certified coping reference and the locked origin-v2 reference.");
    process.exit(0);
  }
  console.log("VERIFY FAIL");
  process.exit(1);
}

main();
