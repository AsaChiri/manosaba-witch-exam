import { describe, it, expect } from "vitest";
import { loadPrepared, loadJson } from "./_load.js";
import { resolveHardAxes, type AnswerMap } from "../src/resolver.js";

/**
 * Origin-v2 parity certification (LOCKED.md 2026-07-10): replay all 200
 * validation personas — coping answers (v1 certified) + origin-v2 N-block
 * answers — through the engine's FULL mode and assert every expected field of
 * `reference_cells.json` (produced by the locked `score_v2.py` + the certified
 * coping scorer). Must pass 200/200.
 */
interface ReferenceCell {
  personaId: string;
  subjectId: string;
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
    guard: {
      qid: string;
      oid: string;
      outcome: string;
      from: string;
      to: string;
    } | null;
    cell: [string, string];
  };
}

const FAMILIES = ["ABN", "ED", "MB", "DEF", "ALN", "FAI", "VC", "POW"];

describe("origin-v2 200-persona parity (reference_cells.json)", () => {
  const prepared = loadPrepared();
  const cells = loadJson<ReferenceCell[]>("reference_cells.json");

  it("has 200 reference personas", () => {
    expect(cells.length).toBe(200);
  });

  it("reproduces every expected field for all 200 personas", () => {
    const mismatches: string[] = [];
    for (const c of cells) {
      const answers: AnswerMap = { ...c.copingAnswers, ...c.originAnswers };
      const { record } = resolveHardAxes(prepared, c.personaId, answers);
      const diffs: string[] = [];
      const e = c.expected;

      if (record.originFamily !== e.originFamily)
        diffs.push(`originFamily ${record.originFamily}!=${e.originFamily}`);
      if (record.originRunnerUp !== e.originRunnerUp)
        diffs.push(`originRunnerUp ${record.originRunnerUp}!=${e.originRunnerUp}`);
      for (const f of FAMILIES) {
        const got = record.originSums[f] ?? 0;
        const want = e.originSums[f] ?? 0;
        if (got !== want) diffs.push(`originSums.${f} ${got}!=${want}`);
      }
      if (record.copingStyle !== e.copingStyle)
        diffs.push(`copingStyle ${record.copingStyle}!=${e.copingStyle}`);
      if (record.copingRunnerUp !== e.copingRunnerUp)
        diffs.push(`copingRunnerUp ${record.copingRunnerUp}!=${e.copingRunnerUp}`);
      if (record.copingConfidence !== e.copingConfidence)
        diffs.push(`copingConfidence ${record.copingConfidence}!=${e.copingConfidence}`);
      if (record.enteredBlock !== e.enteredBlock)
        diffs.push(`enteredBlock ${record.enteredBlock}!=${e.enteredBlock}`);
      if (JSON.stringify(record.guard) !== JSON.stringify(e.guard))
        diffs.push(
          `guard ${JSON.stringify(record.guard)}!=${JSON.stringify(e.guard)}`,
        );
      if (record.cell[0] !== e.cell[0] || record.cell[1] !== e.cell[1])
        diffs.push(`cell ${JSON.stringify(record.cell)}!=${JSON.stringify(e.cell)}`);

      if (diffs.length) mismatches.push(`${c.personaId}: ${diffs.join("; ")}`);
    }
    if (mismatches.length) {
      throw new Error(
        `${mismatches.length}/200 personas diverged:\n${mismatches.slice(0, 10).join("\n")}`,
      );
    }
    expect(mismatches.length).toBe(0);
  });

  it("asks all 28 N-slots in block order in full mode", () => {
    const c = cells[0]!;
    const { record } = resolveHardAxes(prepared, c.personaId, {
      ...c.copingAnswers,
      ...c.originAnswers,
    });
    const nPath = record.askedPath
      .filter((t) => t.startsWith("N"))
      .map((t) => t.split(":")[0]);
    const wantOrder: string[] = [];
    for (let i = 1; i <= 14; i++) {
      const id = `N${String(i).padStart(2, "0")}`;
      wantOrder.push(`${id}M`, `${id}L`);
    }
    expect(nPath).toEqual(wantOrder);
    expect(record.originPathLength).toBe(28);
  });
});
