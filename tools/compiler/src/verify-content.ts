#!/usr/bin/env -S npx tsx
/**
 * Round-trip verification: load the compiled structural content package and
 * prove the engine reproduces the certified scorer references.
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

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
function canon(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(
      value as Record<string, unknown>,
    ).sort()) {
      output[key] = sortKeys(
        (value as Record<string, unknown>)[key],
      );
    }
    return output;
  }
  return value;
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
  const content = src.contentDir;
  const coping = loadJson<CopingTree>(
    join(content, "quiz", "tree.coping.json"),
  );
  const blocks = loadJson<OriginBlocks>(
    join(content, "quiz", "blocks.origin.json"),
  );
  const prepared = prepareTrees(coping, blocks);

  const personas = loadJson<
    { personaId: string; answers: AnswerMap }[]
  >(join(src.scorer, "all_answers.json"));
  const expected = loadJson<Record<string, unknown>[]>(
    join(src.scorer, "scored_r2.json"),
  );
  const byId = new Map(
    expected.map((record) => [
      record["personaId"] as string,
      record,
    ]),
  );
  let copingPass = 0;
  const copingFails: string[] = [];

  for (const persona of personas) {
    const walker = new Walker(
      prepared,
      persona.personaId,
      persona.answers,
      "full",
    );
    walker.coping();
    const want = byId.get(persona.personaId);
    if (!want) {
      copingFails.push(persona.personaId);
      continue;
    }
    const got: Record<string, unknown> = {
      r4Fired: walker.r4Fired,
      stanceVotes: walker.stanceVotes,
      enteredBlock: walker.enteredBlock,
      shadowStance: walker.shadowStance,
      coreTally: walker.coreTally,
      styleVotes: walker.styleVotes,
      tieResolver: walker.tieResolver,
      guard: walker.guard,
      copingStyle: walker.copingStyle,
      copingTrueStance: walker.copingStance,
      copingConfidence: walker.copingConfidence,
      copingRunnerUp: walker.copingRunnerUp,
      copingPathLength: walker.copingLen,
    };
    const askedWant = (want["askedPath"] as string[]).slice(
      0,
      want["copingPathLength"] as number,
    );
    const askedGot = walker.asked.map(([qid, oid]) =>
      typeof oid === "string"
        ? `${qid}:${oid}`
        : `${qid}:${oid.join("+")}`,
    );
    const flagsWant = (want["flags"] as string[]).filter(
      (flag) => !flag.includes("O.") && !flag.startsWith("c1_"),
    );
    const ok =
      COPING_FIELDS.every(
        (key) => canon(got[key]) === canon(want[key]),
      ) &&
      canon(askedGot) === canon(askedWant) &&
      canon(walker.flags) === canon(flagsWant);
    if (ok) copingPass++;
    else copingFails.push(persona.personaId);
  }

  const cells = loadJson<ReferenceCell[]>(
    join(src.originV2, "reference_cells.json"),
  );
  let originPass = 0;
  const originFails: string[] = [];
  for (const cell of cells) {
    const { record } = resolveHardAxes(prepared, cell.personaId, {
      ...cell.copingAnswers,
      ...cell.originAnswers,
    });
    const expectedCell = cell.expected;
    const sumsOk = FAMILIES.every(
      (family) =>
        (record.originSums[family] ?? 0) ===
        (expectedCell.originSums[family] ?? 0),
    );
    const ok =
      record.originFamily === expectedCell.originFamily &&
      record.originRunnerUp === expectedCell.originRunnerUp &&
      sumsOk &&
      record.copingStyle === expectedCell.copingStyle &&
      record.copingRunnerUp === expectedCell.copingRunnerUp &&
      record.copingConfidence === expectedCell.copingConfidence &&
      record.enteredBlock === expectedCell.enteredBlock &&
      canon(record.guard) === canon(expectedCell.guard) &&
      record.cell[0] === expectedCell.cell[0] &&
      record.cell[1] === expectedCell.cell[1];
    if (ok) originPass++;
    else originFails.push(cell.personaId);
  }

  process.stdout.write(
    `coping replay: ${copingPass}/${personas.length}\n` +
      `origin-v2 parity: ${originPass}/${cells.length}\n`,
  );
  if (
    copingPass !== personas.length ||
    originPass !== cells.length
  ) {
    if (copingFails.length) {
      process.stdout.write(
        `coping diverged: ${copingFails.slice(0, 10).join(", ")}\n`,
      );
    }
    if (originFails.length) {
      process.stdout.write(
        `origin diverged: ${originFails.slice(0, 10).join(", ")}\n`,
      );
    }
    process.exit(1);
  }
  process.stdout.write("VERIFY PASS\n");
}

main();
