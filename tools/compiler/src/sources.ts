/** Resolves all workspace + repo paths the compiler reads and writes. */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
/** tools/compiler/src -> repo root (D:/manosaba-witch-exam). */
export const REPO_ROOT = resolve(here, "..", "..", "..");

export interface Sources {
  workspace: string;
  phase3: string;
  scorer: string;
  /** origin v2 locked sources (score_v2.py KEY, item_sheet.md, zh strings, reference_cells). */
  originV2: string;
  copingBank: string;
  picksetBank: string;
  manifest: string;
  cardsDir: string;
  /** character sources for the 13 special character records (design spec §3.7). */
  charactersDir: string;
  cardWork: string;
  contentDir: string;
  shipList: string;
  termMap: string;
}

export function makeSources(workspace: string): Sources {
  const phase3 = join(workspace, "output", "build", "phase3_quiz");
  const scorer = join(phase3, "validation", "scorer");
  return {
    workspace,
    phase3,
    scorer,
    originV2: join(phase3, "validation", "origin_v2"),
    copingBank: join(phase3, "coping_question_bank_draft.md"),
    picksetBank: join(phase3, "subvariant_pickset_bank_draft.md"),
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
    termMap: join(here, "..", "term_map_zhtw.json"),
  };
}

export const DEFAULT_WORKSPACE = "D:/Manosaba_Script_Project_Workspace";
