import { describe, it, expect } from "vitest";
import { loadTrees, loadSlots } from "./_load.js";
import { createExam } from "../src/session.js";
import { resolveTag, subvariantIndex, type AuthoredTag } from "../src/tags.js";
import { pickPairKey } from "../src/keys.js";
import { canonicalString, fnv1a32String } from "../src/hash.js";
import type { ContentPackage, HashSpec, PicksetsFile, NeighborFile } from "../src/schemas.js";

// The worked-example cell DEF × Performer, with an illustrative authored set
// (spec §4.5): {(DEF-1,P-5), (DEF-7,P-2), (DEF-11,P-2)}. Picking (DEF-1,P-2)
// is unauthored -> tier-1 origin match -> serves (DEF-1,P-5).
const AUTHORED: AuthoredTag[] = [
  { tag: "DEF-1xPE-5", origin: "DEF-1", coping: "P-5", manifestIndex: 0 },
  { tag: "DEF-7xPE-2", origin: "DEF-7", coping: "P-2", manifestIndex: 1 },
  { tag: "DEF-11xPE-2", origin: "DEF-11", coping: "P-2", manifestIndex: 2 },
];

function buildContent(): ContentPackage {
  const { coping, origin } = loadTrees();
  const slots = loadSlots();

  const coveredO = ["DEF-1", "DEF-7", "DEF-11"];
  const coveredC = ["P-2", "P-5"];
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
    bankVersion: "v4",
    slots,
    sentinel: "X",
    fnv: { offset: 2166136261, prime: 16777619 },
    variantCounts: { "DEF-1xPE-5": 2 },
    permutation: {
      prng: "xorshift32",
      shuffle: "fisher-yates-descending",
      prePickPrefix: "K.*+N##[ML]",
      withinGroupSeed: "append V.OGROUP",
    },
  };
  return { copingTree: coping, originBlocks: origin, hashSpec, picksets, neighbor };
}

// Coping: the §4.5 certified Performer path. Origin v2: a DEF-heavy N-vector
// (7 DEF most-picks, 2 escapes on N01M/N08M) resolving DEF with runner-up ED.
const answerMap: Record<string, string> = {
  "K.R1": "d", "K.R2": "d", "K.R3": "f",
  "K.A1": "b", "K.A2": "e", "K.A3": "b",
  "K.P10": "b",
  "N01M": "E", "N01L": "B",
  "N02M": "B", "N02L": "D",
  "N03M": "C", "N03L": "A",
  "N04M": "C", "N04L": "B",
  "N05M": "A", "N05L": "C",
  "N06M": "D", "N06L": "B",
  "N07M": "D", "N07L": "A",
  "N08M": "E", "N08L": "A",
  "N09M": "C", "N09L": "D",
  "N10M": "B", "N10L": "C",
  "N11M": "D", "N11L": "A",
  "N12M": "D", "N12L": "B",
  "N13M": "C", "N13L": "A",
  "N14M": "C", "N14L": "A",
  "V.OPICK": "DEF-1", "V.CPICK": "P-2",
};

describe("session drives the v2 exam end-to-end", () => {
  const content = buildContent();

  it("asks coping, then all 28 N-slots in order, then picks; resolves the served card", () => {
    const exam = createExam(content);
    const asked: string[] = [];
    let guard = 0;
    while (!exam.isDone()) {
      if (guard++ > 60) throw new Error("did not terminate");
      const q = exam.current();
      expect(q).not.toBeNull();
      const oid = answerMap[q!.qid];
      expect(oid, `no scripted answer for ${q!.qid}`).toBeDefined();
      asked.push(q!.qid);
      exam.answer(oid!);
    }
    const nOrder: string[] = [];
    for (let i = 1; i <= 14; i++) {
      const id = `N${String(i).padStart(2, "0")}`;
      nOrder.push(`${id}M`, `${id}L`);
    }
    expect(asked).toEqual([
      "K.R1", "K.R2", "K.R3",
      "K.A1", "K.A2", "K.A3",
      "K.P10",
      ...nOrder,
      "V.OPICK", "V.CPICK",
    ]);

    const r = exam.result();
    expect(r.style).toBe("Performer");
    expect(r.trueStance).toBe("ELEVATE");
    expect(r.confidence).toBe("MODERATE");
    expect(r.runnerUp).toBe("Caretaker");
    expect(r.family).toBe("DEF");
    expect(r.top2).toEqual(["DEF", "ED"]);
    expect(r.cell).toEqual({ family: "DEF", style: "Performer" });
    expect(r.redirectedCell).toBeUndefined();
    expect(r.picks).toEqual({ o: "DEF-1", c: "P-2" });
    expect(r.tag).toBe("DEF-1xPE-5"); // tier-1 origin-preserving fallback
    expect(r.tier).toBe(1);

    // canonical 84-slot string: exactly the administered slots tokenized, the
    // sentinel everywhere else; hash + variant follow deterministically.
    const tokens: Record<string, string> = {};
    for (const [qid, oid] of Object.entries(answerMap)) tokens[qid] = oid;
    const want = canonicalString(tokens, content.hashSpec.slots, "X");
    expect(r.canonicalString).toBe(want);
    expect(r.answersHash >>> 0).toBe(fnv1a32String(want) >>> 0);
    expect(r.variantIndex).toBe((r.answersHash >>> 0) % 2);
  });

  it("display-filters the M pick off the L screen (M≠L), unless M escaped", () => {
    const exam = createExam(content);
    // answer coping up to N01M
    for (const qid of ["K.R1", "K.R2", "K.R3", "K.A1", "K.A2", "K.A3", "K.P10"]) {
      exam.answer(answerMap[qid]!);
    }
    // N01M: escape offered alongside A-D
    let q = exam.current()!;
    expect(q.qid).toBe("N01M");
    expect(q.options.map((o) => o.oid)).toEqual(["A", "B", "C", "D", "E"]);
    exam.answer("A"); // non-escape most pick
    q = exam.current()!;
    expect(q.qid).toBe("N01L");
    expect(q.options.map((o) => o.oid)).toEqual(["B", "C", "D"]); // A not answerable
    // ...but the M pick is echoed as a display-only locked option (M≠L, shown).
    expect(q.disabledOptions?.map((o) => o.oid)).toEqual(["A"]);
    expect(typeof q.disabledOptions?.[0]!.text).toBe("string");
    expect(() => exam.answer("A")).toThrow(/not offered/);
    // undo, escape instead: L then offers all four lines, nothing locked.
    exam.back();
    exam.answer("E");
    q = exam.current()!;
    expect(q.qid).toBe("N01L");
    expect(q.options.map((o) => o.oid)).toEqual(["A", "B", "C", "D"]);
    expect(q.disabledOptions).toBeUndefined();
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
