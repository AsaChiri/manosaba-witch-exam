#!/usr/bin/env -S npx tsx
/**
 * Total-coverage verification. Replays all certified origin-v2 personas through
 * the public session and proves every one reaches a shipped tag deterministically.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createExam,
  type ContentPackage,
} from "@manosaba/witch-exam-engine";
import { makeSources, DEFAULT_WORKSPACE } from "./sources.js";

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

interface Persona {
  personaId: string;
  answers: Record<string, string | string[]>;
}
interface Landing {
  personaId: string;
  family: string;
  designFamily: string;
  tag: string;
  tier: number;
  variant: number;
  redirected: string | null;
  hash: string;
}

function loadContent(content: string): ContentPackage {
  const quiz = (file: string) =>
    loadJson(join(content, "quiz", file));
  return {
    questions: quiz("questions.json"),
    strings: quiz("strings.en.json"),
    copingTree: quiz("tree.coping.json"),
    originBlocks: quiz("blocks.origin.json"),
    hashSpec: quiz("hash.spec.json"),
    picksets: quiz("picksets.json"),
    neighbor: quiz("neighbor.json"),
    cardsManifest: loadJson(
      join(content, "cards", "manifest.json"),
    ),
  } as unknown as ContentPackage;
}

function drive(
  content: ContentPackage,
  persona: Persona,
): Landing {
  const exam = createExam(content);
  let guard = 0;
  while (!exam.isDone()) {
    if (guard++ > 60) {
      throw new Error(
        `persona ${persona.personaId}: did not terminate`,
      );
    }
    const current = exam.current()!;
    const offered = current.options.map((option) => option.oid);
    const raw = persona.answers[current.qid];
    let choice: string;
    if (Array.isArray(raw)) {
      choice =
        raw
          .map(String)
          .find((oid) => offered.includes(oid)) ?? offered[0]!;
    } else if (
      typeof raw === "string" &&
      offered.includes(raw)
    ) {
      choice = raw;
    } else {
      choice = offered[0]!;
    }
    exam.answer(choice);
  }
  const result = exam.result();
  const match = /^([A-Za-z]+)/.exec(persona.personaId);
  return {
    personaId: persona.personaId,
    family: result.cell.family,
    designFamily: match ? match[1]!.toUpperCase() : "?",
    tag: result.tag,
    tier: result.tier,
    variant: result.variantIndex,
    redirected: result.redirectedCell
      ? `${result.redirectedCell.family}|${result.redirectedCell.style}`
      : null,
    hash: `0x${(result.answersHash >>> 0)
      .toString(16)
      .toUpperCase()}`,
  };
}

function key(landing: Landing): string {
  return [
    landing.personaId,
    landing.tag,
    landing.tier,
    landing.variant,
    landing.redirected,
    landing.hash,
  ].join("|");
}

function main(): void {
  const workspace = process.argv.includes("--workspace")
    ? process.argv[process.argv.indexOf("--workspace") + 1]!
    : DEFAULT_WORKSPACE;
  const src = makeSources(workspace);
  const content = loadContent(src.contentDir);
  const shippedTags = new Set(
    Object.keys(
      (
        content.cardsManifest as {
          tags: Record<string, unknown>;
        }
      ).tags,
    ),
  );
  for (const character of loadJson<{ tag: string }[]>(
    join(src.contentDir, "characters", "en.json"),
  )) {
    shippedTags.add(character.tag);
  }
  const cells = loadJson<
    {
      personaId: string;
      originAnswers: Record<string, string>;
      copingAnswers: Record<string, string | string[]>;
    }[]
  >(join(src.originV2, "reference_cells.json"));
  const personas: Persona[] = cells.map((cell) => ({
    personaId: cell.personaId,
    answers: {
      ...cell.copingAnswers,
      ...cell.originAnswers,
    },
  }));

  const first = personas.map((persona) => drive(content, persona));
  const second = personas.map((persona) => drive(content, persona));
  const badTags: string[] = [];
  const nonDeterministic: string[] = [];
  const designFamilies = new Set<string>();
  let redirected = 0;

  for (let index = 0; index < first.length; index++) {
    const landing = first[index]!;
    if (key(landing) !== key(second[index]!)) {
      nonDeterministic.push(landing.personaId);
    }
    if (!landing.tag || !shippedTags.has(landing.tag)) {
      badTags.push(
        `${landing.personaId} -> ${landing.tag || "(none)"}`,
      );
    }
    if (landing.redirected) redirected++;
    designFamilies.add(landing.designFamily);
  }

  process.stdout.write(
    `reached shipped tag: ${first.length - badTags.length}/${first.length}\n` +
      `redirected: ${redirected}\n` +
      `deterministic: ${nonDeterministic.length === 0}\n` +
      `design families: ${designFamilies.size}\n`,
  );
  if (
    badTags.length ||
    nonDeterministic.length ||
    designFamilies.size < 8
  ) {
    if (badTags.length) {
      process.stdout.write(
        `dead ends: ${badTags.slice(0, 12).join(", ")}\n`,
      );
    }
    if (nonDeterministic.length) {
      process.stdout.write(
        `non-deterministic: ${nonDeterministic
          .slice(0, 12)
          .join(", ")}\n`,
      );
    }
    process.exit(1);
  }
  process.stdout.write("VERIFY PERSONAS PASS\n");
}

main();
