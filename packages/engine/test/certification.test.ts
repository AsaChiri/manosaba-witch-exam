import { describe, it, expect } from "vitest";
import { loadPrepared, loadSlots } from "./_load.js";
import { resolveHardAxes, type AnswerMap } from "../src/resolver.js";
import { fnv1a32String, canonicalString } from "../src/hash.js";

// Spec §4.5 worked example — the Leia-type persona (Caretaker-surface /
// Performer-core, origin DEF). Certified in validation/scorer/certification.md.
const CERT_ANSWERS: AnswerMap = {
  "K.R1": "d",
  "K.R2": "d",
  "K.R3": "f",
  "K.A1": "b",
  "K.A2": "e",
  "K.A3": "b",
  "K.P10": "b",
  "O.R1": "E",
  "O.R2": "B",
  "O.R3": "F",
  "O.S2": "B",
  "O.S5": "C",
};
const CERT_PICKS: Record<string, string> = {
  "V.OPICK": "DEF-1",
  "V.CPICK": "PE-2",
};

describe("spec §4.5 worked example", () => {
  const prepared = loadPrepared();
  const { record, walker } = resolveHardAxes(prepared, "cert-leia", CERT_ANSWERS);

  it("reproduces the coping resolution", () => {
    expect(record.stanceVotes).toEqual({ ATTACH: 2, ELEVATE: 1 });
    expect(record.enteredBlock).toBe("ATTACH");
    expect(record.shadowStance).toBe("ELEVATE");
    expect(record.r4Fired).toBe(false);
    expect(record.coreTally).toEqual({ Caretaker: 2, Performer: 1 });
    expect(record.tieResolver).toEqual({ qid: "K.P10", oid: "b", voted: "Performer" });
    expect(record.styleVotes).toEqual({ Caretaker: 2, Performer: 3 });
    expect(record.copingStyle).toBe("Performer");
    expect(record.copingConfidence).toBe("MODERATE");
    expect(record.copingRunnerUp).toBe("Caretaker");
    expect(record.copingTrueStance).toBe("ELEVATE");
    expect(record.guard).toBeNull();
    expect(record.copingPathLength).toBe(7);
  });

  it("reproduces the origin resolution", () => {
    expect(record.prior).toEqual({ DEF: 1, ALN: 1, ED: 1 });
    expect(record.firedSeps).toEqual(["O.S2", "O.S5"]);
    expect(record.firedDiscs).toEqual([]);
    expect(record.c1).toBeNull();
    expect(record.V).toEqual({ DEF: 9, FAI: 4, ALN: 1 });
    expect(record.originFamily).toBe("DEF");
    expect(record.originTop2).toEqual(["DEF", "FAI"]);
    expect(record.originPathLength).toBe(5);
    expect(record.cell).toEqual(["DEF", "Performer"]);
    expect(record.flags).toEqual([]);
  });

  it("reproduces the intermediate S trace", () => {
    const tr = Object.fromEntries(walker.trace.map((t) => [t.after, t.S]));
    expect(tr["O.R1:E"]).toEqual({ DEF: 3, ALN: 1, ED: 1, FAI: 1 });
    expect(tr["O.R2:B"]).toEqual({ DEF: 4, ALN: 1, ED: 1, FAI: 2 });
    expect(tr["O.R3:F"]).toEqual({ DEF: 6, ALN: 1, ED: 1, FAI: 3 });
    expect(tr["O.S2:B"]).toEqual({ DEF: 8, ALN: 1, ED: 1, FAI: 4 });
    expect(tr["O.S5:C"]).toEqual({ DEF: 10, ALN: 2, ED: 1, FAI: 4 });
  });

  it("reproduces the Appendix A v3 canonical string, byte length and FNV-1a hash", () => {
    const slots = loadSlots();
    const tokens = { ...walker.tokenMap, ...CERT_PICKS };
    const s = canonicalString(tokens, slots, "X");
    const bytes = new TextEncoder().encode(s).length;
    const h = fnv1a32String(s);
    expect(bytes).toBe(665);
    expect(h >>> 0).toBe(0x46a43834);
    expect((h >>> 0) % 2).toBe(0); // variantIndex on N=2
  });
});

// Independent FNV-1a correctness vectors: the retired v2 (82-slot) and v1
// (81-slot) canonical strings pinned verbatim in certification.md §3. Different
// inputs, different pinned outputs — they exercise the hash on more than one
// string. (v1/v2/v3 are not comparable; nothing shipped under v1/v2.)
describe("retired FNV-1a pins (certification.md §3)", () => {
  const V2 =
    "K.R1:d|K.R2:d|K.R3:f|K.R4:X|K.N1:X|K.N2:X|K.N3:X|K.NT:X|K.W1:X|K.W2:X|K.W3:X|K.WT:X|K.S1:X|K.S2:X|K.S3:X|K.ST:X|K.A1:b|K.A2:e|K.A3:b|K.AT:X|K.AS1:X|K.AS2:X|K.AS3:X|K.AST:X|K.E1:X|K.E2:X|K.E3:X|K.ET:X|K.C1:X|K.C2:X|K.C3:X|K.CT:X|K.P1:X|K.P2:X|K.P3:X|K.P4:X|K.P5:X|K.P6:X|K.P7:X|K.P8:X|K.P9:X|K.P10:b|K.P11:X|K.P12:X|K.P13:X|K.P14:X|K.P15:X|K.P16:X|O.R1:E|O.R2:B|O.S1:X|O.S2:B|O.S3:X|O.S4:X|O.S5:X|O.P1:X|O.P1b:X|O.P2:X|O.P2b:X|O.P3:X|O.P3b:X|O.P4:X|O.P5:X|O.P5b:X|O.B1:X|O.B2:X|O.B3:X|O.B3b:X|O.B4:X|O.B5:X|O.B6:X|O.B7:X|O.B8:X|O.B9:X|O.B10:X|O.B11:X|O.B12:X|O.B13:X|O.C1:X|V.OGROUP:X|V.OPICK:DEF-1|V.CPICK:PE-2";
  const V1 = V2.replace("|V.OGROUP:X", "");

  it("reproduces the v2 pin (610 bytes, 0x6FC8FE2D)", () => {
    expect(new TextEncoder().encode(V2).length).toBe(610);
    expect(fnv1a32String(V2) >>> 0).toBe(0x6fc8fe2d);
  });
  it("reproduces the v1 pin (599 bytes, 0xF6ADEE5B)", () => {
    expect(new TextEncoder().encode(V1).length).toBe(599);
    expect(fnv1a32String(V1) >>> 0).toBe(0xf6adee5b);
  });
});
