import { describe, it, expect } from "vitest";
import { loadTrees, loadSlots } from "./_load.js";
import { createExam } from "../src/session.js";
import { resolveTag, subvariantIndex, type AuthoredTag } from "../src/tags.js";
import { pickPairKey } from "../src/keys.js";
import type { ContentPackage, HashSpec, PicksetsFile, NeighborFile } from "../src/schemas.js";

// The worked-example cell DEF × Performer, with an illustrative authored set
// (spec §4.5): {(DEF-1,PE-5), (DEF-7,PE-2), (DEF-11,PE-2)}. Picking (DEF-1,PE-2)
// is unauthored -> tier-1 origin match -> serves (DEF-1,PE-5).
const AUTHORED: AuthoredTag[] = [
  { tag: "DEF-1xPE-5", origin: "DEF-1", coping: "PE-5", manifestIndex: 0 },
  { tag: "DEF-7xPE-2", origin: "DEF-7", coping: "PE-2", manifestIndex: 1 },
  { tag: "DEF-11xPE-2", origin: "DEF-11", coping: "PE-2", manifestIndex: 2 },
];

function buildContent(): ContentPackage {
  const { coping, origin } = loadTrees();
  const slots = loadSlots();

  const coveredO = ["DEF-1", "DEF-7", "DEF-11"];
  const coveredC = ["PE-2", "PE-5"];
  const table: Record<string, string> = {};
  const tiers: Record<string, number> = {};
  for (const o of coveredO) {
    for (const c of coveredC) {
      const r = resolveTag(o, c, AUTHORED, subvariantIndex, subvariantIndex)!;
      table[pickPairKey(o, c)] = r.tag;
      tiers[pickPairKey(o, c)] = r.tier;
    }
  }
  const neighbor: NeighborFile = { "DEF|Performer": { table, tiers } };
  const picksets: PicksetsFile = {
    redirect: {},
    cells: {
      "DEF|Performer": {
        origin: { options: coveredO },
        coping: { options: coveredC },
      },
    },
  };
  const hashSpec: HashSpec = {
    bankVersion: "v3",
    slots,
    sentinel: "X",
    fnv: { offset: 2166136261, prime: 16777619 },
    variantCounts: { "DEF-1xPE-5": 2 },
    permutation: {
      prng: "xorshift32",
      shuffle: "fisher-yates-descending",
      prePickPrefix: "K.*+O.*",
      withinGroupSeed: "append V.OGROUP",
    },
  };
  return { copingTree: coping, originTree: origin, hashSpec, picksets, neighbor };
}

describe("session drives the worked-example end-to-end", () => {
  const content = buildContent();
  // Answers for every slot the walk will ask, plus the two pick screens.
  const answerMap: Record<string, string> = {
    "K.R1": "d", "K.R2": "d", "K.R3": "f",
    "K.A1": "b", "K.A2": "e", "K.A3": "b",
    "K.P10": "b",
    "O.R1": "E", "O.R2": "B", "O.R3": "F", "O.S2": "B", "O.S5": "C",
    "V.OPICK": "DEF-1", "V.CPICK": "PE-2",
  };

  it("asks exactly the certified path then resolves the served card", () => {
    const exam = createExam(content);
    const asked: string[] = [];
    let guard = 0;
    while (!exam.isDone()) {
      if (guard++ > 40) throw new Error("did not terminate");
      const q = exam.current();
      expect(q).not.toBeNull();
      const oid = answerMap[q!.qid];
      expect(oid, `no scripted answer for ${q!.qid}`).toBeDefined();
      asked.push(q!.qid);
      exam.answer(oid!);
    }
    expect(asked).toEqual([
      "K.R1", "K.R2", "K.R3",
      "K.A1", "K.A2", "K.A3",
      "K.P10",
      "O.R1", "O.R2", "O.R3", "O.S2", "O.S5",
      "V.OPICK", "V.CPICK",
    ]);

    const r = exam.result();
    expect(r.style).toBe("Performer");
    expect(r.trueStance).toBe("ELEVATE");
    expect(r.confidence).toBe("MODERATE");
    expect(r.runnerUp).toBe("Caretaker");
    expect(r.family).toBe("DEF");
    expect(r.top2).toEqual(["DEF", "FAI"]);
    expect(r.cell).toEqual({ family: "DEF", style: "Performer" });
    expect(r.redirectedCell).toBeUndefined();
    expect(r.picks).toEqual({ o: "DEF-1", c: "PE-2" });
    expect(r.tag).toBe("DEF-1xPE-5"); // tier-1 origin-preserving fallback
    expect(r.tier).toBe(1);
    // full 89-slot canonical hash == the §4.5 pin, variantIndex 0 on N=2.
    expect(r.answersHash >>> 0).toBe(0x46a43834);
    expect(new TextEncoder().encode(r.canonicalString).length).toBe(665);
    expect(r.variantIndex).toBe(0);
  });

  it("progress + back behave", () => {
    const exam = createExam(content);
    expect(exam.progress()).toEqual({ phase: "coping", answeredCount: 0 });
    exam.answer("d"); // K.R1
    expect(exam.progress().answeredCount).toBe(1);
    expect(exam.canGoBack()).toBe(true);
    exam.back();
    expect(exam.progress().answeredCount).toBe(0);
    expect(exam.current()!.qid).toBe("K.R1");
  });
});
