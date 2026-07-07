import { describe, it, expect } from "vitest";
import { loadPrepared, loadJson } from "./_load.js";
import { resolveHardAxes, type AnswerMap, type ScoreRecord } from "../src/resolver.js";

interface PersonaAnswers {
  personaId: string;
  answers: AnswerMap;
}

/**
 * Replay ALL 200 blind personas through the TS engine and assert byte-identical
 * resolution against the certified Python reference outputs (scored_r2.json).
 * Any divergence is a bug in the engine, not the fixture.
 */
describe("200-persona reference replay", () => {
  const prepared = loadPrepared();
  const personas = loadJson<PersonaAnswers[]>("all_answers.json");
  const expected = loadJson<ScoreRecord[]>("scored_r2.json");
  const byId = new Map(expected.map((r) => [r.personaId, r]));

  it("has 200 personas and 200 expected records", () => {
    expect(personas.length).toBe(200);
    expect(expected.length).toBe(200);
  });

  it("resolves all 200 personas identically to the reference", () => {
    const mismatches: { id: string; diffs: string[] }[] = [];
    for (const p of personas) {
      const { record } = resolveHardAxes(prepared, p.personaId, p.answers);
      const want = byId.get(p.personaId);
      if (!want) {
        mismatches.push({ id: p.personaId, diffs: ["no expected record"] });
        continue;
      }
      const diffs = diffRecords(record, want);
      if (diffs.length) mismatches.push({ id: p.personaId, diffs });
    }
    if (mismatches.length) {
      const preview = mismatches
        .slice(0, 10)
        .map((m) => `${m.id}: ${m.diffs.join("; ")}`)
        .join("\n");
      throw new Error(
        `${mismatches.length}/200 personas diverged:\n${preview}`,
      );
    }
    expect(mismatches.length).toBe(0);
  });
});

/** Structural equality by canonical JSON (object key order ignored). */
function diffRecords(got: ScoreRecord, want: ScoreRecord): string[] {
  const diffs: string[] = [];
  const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
  for (const k of keys) {
    const a = canon((got as Record<string, unknown>)[k]);
    const b = canon((want as Record<string, unknown>)[k]);
    if (a !== b) diffs.push(`${k}: got ${a} want ${b}`);
  }
  return diffs;
}

function canon(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}
