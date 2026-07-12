import { describe, it, expect } from "vitest";
import { loadJson, loadTrees, loadSlots } from "./_load.js";
import {
  CopingTreeSchema,
  OriginBlocksSchema,
  validateContent,
  type HashSpec,
} from "../src/index.js";

function makeHashSpec(): HashSpec {
  return {
    bankVersion: "v4",
    slots: loadSlots(),
    sentinel: "X",
    fnv: { offset: 2166136261, prime: 16777619 },
    variantCounts: {},
    permutation: {
      prng: "xorshift32",
      shuffle: "fisher-yates-descending",
      prePickPrefix: "K.*+N##[ML]",
      withinGroupSeed: "append V.OGROUP",
    },
  };
}

describe("content schemas", () => {
  it("parses the certified coping tree + origin-v2 blocks", () => {
    const { coping, origin } = loadTrees();
    expect(() => CopingTreeSchema.parse(coping)).not.toThrow();
    expect(() => OriginBlocksSchema.parse(origin)).not.toThrow();
  });

  it("validateContent accepts a well-formed package and rejects a broken one", () => {
    const { coping, origin } = loadTrees();
    const hashSpec = makeHashSpec();
    const good = { copingTree: coping, originBlocks: origin, hashSpec };
    expect(() => validateContent(good)).not.toThrow();

    // a block keyed to an unknown family must be rejected
    const brokenBlocks = {
      ...origin,
      blocks: origin.blocks.map((b, i) =>
        i === 0 ? { ...b, key: { ...b.key, A: "NOPE" } } : b,
      ),
    };
    expect(() =>
      validateContent({ copingTree: coping, originBlocks: brokenBlocks, hashSpec }),
    ).toThrow(/unknown family NOPE/);

    // a block missing one of the A-D letters must be rejected
    const { D: _d, ...threeKey } = origin.blocks[0]!.key;
    const shortBlocks = {
      ...origin,
      blocks: origin.blocks.map((b, i) => (i === 0 ? { ...b, key: threeKey } : b)),
    };
    expect(() =>
      validateContent({ copingTree: coping, originBlocks: shortBlocks, hashSpec }),
    ).toThrow(/key letters must be exactly A-D/);

    // slot list must carry every N##M / N##L slot
    const noNSlots = { ...hashSpec, slots: hashSpec.slots.filter((s) => !s.startsWith("N")) };
    expect(() =>
      validateContent({ copingTree: coping, originBlocks: origin, hashSpec: noNSlots }),
    ).toThrow(/missing origin slot/);
  });

  it("slots.json is the 84-slot v4 list (53 K + 28 N + 3 V)", () => {
    const slots = loadJson<{ slots: string[]; version: string }>("slots.json");
    expect(slots.slots.length).toBe(84);
    expect(slots.version).toBe("v4");
    expect(slots.slots.filter((s) => s.startsWith("K.")).length).toBe(53);
    expect(slots.slots.filter((s) => /^N\d{2}[ML]$/.test(s)).length).toBe(28);
    expect(slots.slots.filter((s) => s.startsWith("V.")).length).toBe(3);
    expect(slots.slots.some((s) => s.startsWith("O."))).toBe(false);
  });
});
