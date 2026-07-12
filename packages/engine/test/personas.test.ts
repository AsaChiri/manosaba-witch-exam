import { describe, it, expect } from "vitest";
import { loadPrepared, loadJson } from "./_load.js";
import { Walker, type AnswerMap } from "../src/resolver.js";

interface PersonaAnswers {
  personaId: string;
  answers: AnswerMap;
}

/** The coping-side fields of the certified reference records (scored_r2.json). */
interface ExpectedCoping {
  personaId: string;
  askedPath: string[];
  copingPathLength: number;
  r4Fired: boolean;
  stanceVotes: Record<string, number>;
  enteredBlock: string | null;
  shadowStance: string | null;
  coreTally: Record<string, number>;
  styleVotes: Record<string, number>;
  tieResolver: unknown;
  guard: unknown;
  copingStyle: string | null;
  copingTrueStance: string | null;
  copingConfidence: string | null;
  copingRunnerUp: string | null;
  flags: string[];
}

/** Origin-v1 flags in the frozen reference no longer apply (v1 tree retired). */
const isCopingFlag = (f: string): boolean => !f.includes("O.") && !f.startsWith("c1_");

/**
 * Replay ALL 200 blind personas' COPING walk through the TS engine and assert
 * byte-identical resolution against the certified Python reference outputs
 * (scored_r2.json). The origin fields of the frozen reference belong to the
 * retired v1 tree; origin-v2 parity is certified separately in
 * origin-v2.test.ts against reference_cells.json.
 */
describe("200-persona coping reference replay", () => {
  const prepared = loadPrepared();
  const personas = loadJson<PersonaAnswers[]>("all_answers.json");
  const expected = loadJson<ExpectedCoping[]>("scored_r2.json");
  const byId = new Map(expected.map((r) => [r.personaId, r]));

  it("has 200 personas and 200 expected records", () => {
    expect(personas.length).toBe(200);
    expect(expected.length).toBe(200);
  });

  it("resolves all 200 coping walks identically to the reference", () => {
    const mismatches: { id: string; diffs: string[] }[] = [];
    for (const p of personas) {
      const w = new Walker(prepared, p.personaId, p.answers, "full");
      w.coping();
      const want = byId.get(p.personaId);
      if (!want) {
        mismatches.push({ id: p.personaId, diffs: ["no expected record"] });
        continue;
      }
      const got: ExpectedCoping = {
        personaId: p.personaId,
        askedPath: w.asked.map(([q, o]) =>
          typeof o === "string" ? `${q}:${o}` : `${q}:${o.join("+")}`,
        ),
        copingPathLength: w.copingLen,
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
        flags: w.flags,
      };
      const wantCoping: ExpectedCoping = {
        ...pickCopingFields(want),
        askedPath: want.askedPath.slice(0, want.copingPathLength),
        flags: want.flags.filter(isCopingFlag),
      };
      const diffs = diffRecords(got, wantCoping);
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

function pickCopingFields(r: ExpectedCoping): ExpectedCoping {
  return {
    personaId: r.personaId,
    askedPath: r.askedPath,
    copingPathLength: r.copingPathLength,
    r4Fired: r.r4Fired,
    stanceVotes: r.stanceVotes,
    enteredBlock: r.enteredBlock,
    shadowStance: r.shadowStance,
    coreTally: r.coreTally,
    styleVotes: r.styleVotes,
    tieResolver: r.tieResolver,
    guard: r.guard,
    copingStyle: r.copingStyle,
    copingTrueStance: r.copingTrueStance,
    copingConfidence: r.copingConfidence,
    copingRunnerUp: r.copingRunnerUp,
    flags: r.flags,
  };
}

/** Structural equality by canonical JSON (object key order ignored). */
function diffRecords(got: ExpectedCoping, want: ExpectedCoping): string[] {
  const diffs: string[] = [];
  const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
  for (const k of keys) {
    const a = canon((got as unknown as Record<string, unknown>)[k]);
    const b = canon((want as unknown as Record<string, unknown>)[k]);
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
