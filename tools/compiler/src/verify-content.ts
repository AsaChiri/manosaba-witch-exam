#!/usr/bin/env -S npx tsx
/**
 * Round-trip verification: load the COMPILED content package and prove the
 * engine resolves the 200 blind personas byte-identically to the certified
 * reference (scored_r2.json), plus the §4.5 worked-example hash. This is the
 * end-to-end guarantee that the emitted tree tables + hash spec are correct and
 * engine-consumable. Exit 0 on 200/200 + cert PASS, else 1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  prepareTrees,
  resolveHardAxes,
  canonicalString,
  fnv1a32String,
  type CopingTree,
  type OriginTree,
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

function main(): void {
  const workspace = process.argv.includes("--workspace")
    ? process.argv[process.argv.indexOf("--workspace") + 1]!
    : DEFAULT_WORKSPACE;
  const src = makeSources(workspace);
  const C = src.contentDir;

  const coping = loadJson<CopingTree>(join(C, "quiz", "tree.coping.json"));
  const origin = loadJson<OriginTree>(join(C, "quiz", "tree.origin.json"));
  const hashSpec = loadJson<{ slots: string[]; sentinel: string }>(join(C, "quiz", "hash.spec.json"));
  const prepared = prepareTrees(coping, origin);

  // 200-persona replay
  const personas = loadJson<{ personaId: string; answers: AnswerMap }[]>(join(src.scorer, "all_answers.json"));
  const expected = loadJson<Record<string, unknown>[]>(join(src.scorer, "scored_r2.json"));
  const byId = new Map(expected.map((r) => [r["personaId"] as string, r]));
  let pass = 0;
  const fails: string[] = [];
  for (const p of personas) {
    const { record } = resolveHardAxes(prepared, p.personaId, p.answers);
    const want = byId.get(p.personaId);
    if (want && canon(record) === canon(want)) pass++;
    else fails.push(p.personaId);
  }

  // §4.5 worked example hash through the compiled slot order
  const cert: AnswerMap = {
    "K.R1": "d", "K.R2": "d", "K.R3": "f", "K.A1": "b", "K.A2": "e", "K.A3": "b",
    "K.P10": "b", "O.R1": "E", "O.R2": "B", "O.R3": "F", "O.S2": "B", "O.S5": "C",
  };
  const { walker } = resolveHardAxes(prepared, "cert", cert);
  const tokens = { ...walker.tokenMap, "V.OPICK": "DEF-1", "V.CPICK": "PE-2" };
  const s = canonicalString(tokens, hashSpec.slots, hashSpec.sentinel);
  const hash = fnv1a32String(s) >>> 0;
  const certOk = hash === 0x46a43834 && new TextEncoder().encode(s).length === 665;

  console.log(`round-trip persona replay: ${pass}/200`);
  console.log(`§4.5 worked-example hash:  0x${hash.toString(16).toUpperCase()} (${certOk ? "PASS" : "FAIL"})`);
  if (fails.length) console.log(`  diverged: ${fails.slice(0, 10).join(", ")}${fails.length > 10 ? " ..." : ""}`);

  if (pass === 200 && certOk) {
    console.log("VERIFY PASS — compiled content is byte-identical to the certified reference.");
    process.exit(0);
  }
  console.log("VERIFY FAIL");
  process.exit(1);
}

main();
