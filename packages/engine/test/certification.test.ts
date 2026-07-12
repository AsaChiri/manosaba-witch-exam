import { describe, it, expect } from "vitest";
import { loadPrepared } from "./_load.js";
import { Walker, type AnswerMap } from "../src/resolver.js";
import { fnv1a32String } from "../src/hash.js";

// Spec §4.5 worked example, COPING axis — the Leia-type persona
// (Caretaker-surface / Performer-core). Certified in
// validation/scorer/certification.md. The v1 origin walk + the §4.5 full-vector
// hash pin were retired with the origin-v2 cutover (DECISIONS.md D11); the
// coping certification stays byte-identical.
const CERT_ANSWERS: AnswerMap = {
  "K.R1": "d",
  "K.R2": "d",
  "K.R3": "f",
  "K.A1": "b",
  "K.A2": "e",
  "K.A3": "b",
  "K.P10": "b",
};

describe("spec §4.5 worked example (coping certification)", () => {
  const prepared = loadPrepared();
  const walker = new Walker(prepared, "cert-leia", CERT_ANSWERS, "full");
  walker.coping();

  it("reproduces the coping resolution", () => {
    expect(walker.stanceVotes).toEqual({ ATTACH: 2, ELEVATE: 1 });
    expect(walker.enteredBlock).toBe("ATTACH");
    expect(walker.shadowStance).toBe("ELEVATE");
    expect(walker.r4Fired).toBe(false);
    expect(walker.coreTally).toEqual({ Caretaker: 2, Performer: 1 });
    expect(walker.tieResolver).toEqual({ qid: "K.P10", oid: "b", voted: "Performer" });
    expect(walker.styleVotes).toEqual({ Caretaker: 2, Performer: 3 });
    expect(walker.copingStyle).toBe("Performer");
    expect(walker.copingConfidence).toBe("MODERATE");
    expect(walker.copingRunnerUp).toBe("Caretaker");
    expect(walker.copingStance).toBe("ELEVATE");
    expect(walker.guard).toBeNull();
    expect(walker.copingLen).toBe(7);
    expect(walker.flags).toEqual([]);
  });

  it("asks exactly the certified coping path", () => {
    expect(walker.asked.map(([q]) => q)).toEqual([
      "K.R1", "K.R2", "K.R3",
      "K.A1", "K.A2", "K.A3",
      "K.P10",
    ]);
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
