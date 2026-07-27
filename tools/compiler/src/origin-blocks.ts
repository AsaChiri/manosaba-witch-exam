/**
 * Structural origin-v2 compiler.
 *
 * Question/choice prose is intentionally not read here. The compiler extracts
 * only the locked KEY and ORDER from score_v2.py to build blocks.origin.json.
 * Committed `content/quiz/strings.*.json` files own all display text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OriginBlocks } from "@manosaba/witch-exam-engine";

export const ESCAPE_OID = "E";

const LOCKED_REGISTERS: Record<string, string> = {
  N01: "scenes",
  N02: "scenes",
  N03: "sentences",
  N04: "sentences",
  N05: "hums",
  N06: "hums",
  N07: "rules",
  N08: "rules",
  N09: "weather",
  N10: "weather",
  N11: "needed",
  N12: "needed",
  N13: "stings",
  N14: "stings",
};

export function parseScoreV2(path: string): {
  order: string[];
  key: Record<string, Record<string, string>>;
} {
  const text = readFileSync(path, "utf8");
  const orderMatch = /ORDER\s*=\s*\[([^\]]*)\]/.exec(text);
  if (!orderMatch) {
    throw new Error(`origin-v2: ORDER list not found in ${path}`);
  }
  const order = [...orderMatch[1]!.matchAll(/"([A-Z]+)"/g)].map(
    (match) => match[1]!,
  );

  const key: Record<string, Record<string, string>> = {};
  const rowPattern = /"(N\d{2})":\s*\{([^}]*)\}/g;
  for (const match of text.matchAll(rowPattern)) {
    const cells: Record<string, string> = {};
    for (const cell of match[2]!.matchAll(
      /"([A-D])":\s*"([A-Z]+)"/g,
    )) {
      cells[cell[1]!] = cell[2]!;
    }
    key[match[1]!] = cells;
  }

  if (Object.keys(key).length !== 14) {
    throw new Error(
      `origin-v2: expected 14 KEY rows in ${path}, got ${Object.keys(key).length}`,
    );
  }
  for (const [block, cells] of Object.entries(key)) {
    const letters = Object.keys(cells).sort().join(",");
    if (letters !== "A,B,C,D") {
      throw new Error(
        `origin-v2: KEY ${block} letters ${letters} != A,B,C,D`,
      );
    }
    for (const family of Object.values(cells)) {
      if (!order.includes(family)) {
        throw new Error(
          `origin-v2: KEY ${block} family ${family} not in ORDER`,
        );
      }
    }
  }
  return { order, key };
}

export function loadOriginBlocks(originV2Dir: string): OriginBlocks {
  const { order, key } = parseScoreV2(
    join(originV2Dir, "score_v2.py"),
  );
  return {
    version: "origin-v2",
    escape: ESCAPE_OID,
    families: order,
    blocks: Object.keys(key)
      .sort()
      .map((id) => ({
        id,
        register: LOCKED_REGISTERS[id]!,
        key: {
          A: key[id]!["A"]!,
          B: key[id]!["B"]!,
          C: key[id]!["C"]!,
          D: key[id]!["D"]!,
        },
      })),
  };
}
