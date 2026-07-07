import { describe, it, expect } from "vitest";
import { loadJson, loadTrees, loadSlots } from "./_load.js";
import {
  CopingTreeSchema,
  OriginTreeSchema,
  validateContent,
  type HashSpec,
} from "../src/index.js";

describe("content schemas", () => {
  it("parses the certified coping/origin trees", () => {
    const { coping, origin } = loadTrees();
    expect(() => CopingTreeSchema.parse(coping)).not.toThrow();
    expect(() => OriginTreeSchema.parse(origin)).not.toThrow();
  });

  it("validateContent accepts a well-formed package and rejects a broken one", () => {
    const { coping, origin } = loadTrees();
    const hashSpec: HashSpec = {
      bankVersion: "v3",
      slots: loadSlots(),
      sentinel: "X",
      fnv: { offset: 2166136261, prime: 16777619 },
      variantCounts: {},
      permutation: {
        prng: "xorshift32",
        shuffle: "fisher-yates-descending",
        prePickPrefix: "K.*+O.*",
        withinGroupSeed: "append V.OGROUP",
      },
    };
    const good = { copingTree: coping, originTree: origin, hashSpec };
    expect(() => validateContent(good)).not.toThrow();

    const brokenOrigin = { ...origin, prior: {} };
    expect(() =>
      validateContent({ copingTree: coping, originTree: brokenOrigin, hashSpec }),
    ).toThrow(/missing prior row/);
  });

  it("slots.json is the frozen 89-slot v3 list", () => {
    const slots = loadJson<{ slots: string[]; version: string }>("slots.json");
    expect(slots.slots.length).toBe(89);
    expect(slots.version).toBe("v3");
  });
});
