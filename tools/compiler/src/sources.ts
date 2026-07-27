/** Resolves all workspace + repo paths the compiler reads and writes. */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
/** tools/compiler/src -> repo root (D:/manosaba-witch-exam). */
export const REPO_ROOT = resolve(here, "..", "..", "..");

export interface Sources {
  workspace: string;
  /** Certified structural scorer sources; no display prose is read from here. */
  scorer: string;
  /** Locked origin-v2 score key source. */
  originV2: string;
  /** Ultimate design source for the locked THIN-cell routing rules. */
  manifest: string;
  cardsDir: string;
  /** character sources for the 13 special character records (design spec §3.7). */
  charactersDir: string;
  cardWork: string;
  contentDir: string;
  shipList: string;
}

export function makeSources(workspace: string): Sources {
  const phase3 = join(workspace, "output", "build", "phase3_quiz");
  return {
    workspace,
    scorer: join(phase3, "validation", "scorer"),
    originV2: join(phase3, "validation", "origin_v2"),
    manifest: join(
      workspace,
      "output",
      "build",
      "phase2_composition",
      "authoring_manifest.md",
    ),
    cardsDir: join(workspace, "output", "cards"),
    charactersDir: join(workspace, "output", "characters"),
    cardWork: join(workspace, "output", "build", "card_work"),
    contentDir: join(REPO_ROOT, "content"),
    shipList: join(REPO_ROOT, "content", "ship_list.json"),
  };
}

export const DEFAULT_WORKSPACE = "D:/Manosaba_Script_Project_Workspace";
