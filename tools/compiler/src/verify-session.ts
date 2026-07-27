#!/usr/bin/env -S npx tsx
/**
 * End-to-end smoke on the compiled content: drive one certified persona through
 * the public session to a served card.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createExam,
  type ContentPackage,
} from "@manosaba/witch-exam-engine";
import { makeSources, DEFAULT_WORKSPACE } from "./sources.js";

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  const workspace = process.argv.includes("--workspace")
    ? process.argv[process.argv.indexOf("--workspace") + 1]!
    : DEFAULT_WORKSPACE;
  const src = makeSources(workspace);
  const content = src.contentDir;
  const quiz = (file: string) =>
    loadJson(join(content, "quiz", file));
  const pkg = {
    questions: quiz("questions.json"),
    strings: quiz("strings.en.json"),
    copingTree: quiz("tree.coping.json"),
    originBlocks: quiz("blocks.origin.json"),
    hashSpec: quiz("hash.spec.json"),
    picksets: quiz("picksets.json"),
    neighbor: quiz("neighbor.json"),
    cardsManifest: loadJson(
      join(content, "cards", "manifest.json"),
    ),
  } as unknown as ContentPackage;

  const cells = loadJson<
    {
      personaId: string;
      originAnswers: Record<string, string>;
      copingAnswers: Record<string, string | string[]>;
      expected: { cell: [string, string] };
    }[]
  >(join(src.originV2, "reference_cells.json"));
  const authored = new Set(
    Object.keys(
      (pkg.picksets as { cells: object }).cells,
    ),
  );
  const target = cells.find((record) =>
    authored.has(
      `${record.expected.cell[0]}|${record.expected.cell[1]}`,
    ),
  );
  if (!target) {
    throw new Error("no certified persona lands on an authored cell");
  }

  const answers = {
    ...target.copingAnswers,
    ...target.originAnswers,
  };
  const exam = createExam(pkg);
  const asked: string[] = [];
  let guard = 0;
  while (!exam.isDone()) {
    if (guard++ > 60) throw new Error("session did not terminate");
    const current = exam.current()!;
    const offered = current.options.map((option) => option.oid);
    const raw = answers[current.qid];
    let choice: string;
    if (Array.isArray(raw)) {
      choice =
        raw.find((oid) => offered.includes(String(oid))) ??
        offered[0]!;
    } else if (
      typeof raw === "string" &&
      offered.includes(raw)
    ) {
      choice = raw;
    } else {
      choice = offered[0]!;
    }
    asked.push(`${current.qid}:${choice}`);
    exam.answer(choice);
  }
  const result = exam.result();
  process.stdout.write(
    `persona ${target.personaId} -> ${result.cell.family}|${result.cell.style}\n` +
      `served ${result.tag} (tier ${result.tier}, variant ${result.variantIndex})\n` +
      `path length ${asked.length}\nSESSION SMOKE PASS\n`,
  );
}

main();
