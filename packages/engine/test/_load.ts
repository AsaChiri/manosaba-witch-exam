import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { CopingTree, OriginTree } from "../src/schemas.js";
import { prepareTrees, type Prepared } from "../src/resolver.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "fixtures");

export function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
}

/** Build the coping/origin trees from the certified reference data. */
export function loadTrees(): { coping: CopingTree; origin: OriginTree } {
  const coping = loadJson<CopingTree>("questions_k.json");
  const originRaw = loadJson<Omit<OriginTree, "prior">>("questions_o.json");
  const prior = loadJson<{ rows: OriginTree["prior"] }>("prior.json").rows;
  const origin: OriginTree = { ...originRaw, prior };
  return { coping, origin };
}

export function loadPrepared(): Prepared {
  const { coping, origin } = loadTrees();
  return prepareTrees(coping, origin);
}

export function loadSlots(): string[] {
  return loadJson<{ slots: string[] }>("slots.json").slots;
}
