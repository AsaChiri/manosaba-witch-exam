import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CopingTree, OriginBlocks } from "../src/schemas.js";
import { prepareTrees, type Prepared } from "../src/resolver.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "fixtures");

export function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

/** Build the coping tree (certified reference) + origin-v2 blocks. */
export function loadTrees(): { coping: CopingTree; origin: OriginBlocks } {
  const coping = loadJson<CopingTree>("questions_k.json");
  const origin = loadJson<OriginBlocks>("blocks.origin.json");
  return { coping, origin };
}

export function loadPrepared(): Prepared {
  const { coping, origin } = loadTrees();
  return prepareTrees(coping, origin);
}

export function loadSlots(): string[] {
  return loadJson<{ slots: string[] }>("slots.json").slots;
}
