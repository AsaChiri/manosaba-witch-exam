/**
 * Content validation helpers. The compiler calls these to fail loudly before
 * writing; a runtime host may call them on load. Thin wrappers around the zod
 * schemas plus a couple of cross-file invariants the schemas can't express.
 */
import {
  ContentPackageSchema,
  CopingTreeSchema,
  OriginBlocksSchema,
  HashSpecSchema,
  type ContentPackage,
} from "./schemas.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Validate a full content package against the schemas + cross-file invariants
 * (hash-spec slot count, coping/origin tree integrity). Returns the parsed
 * package; throws an aggregated error on any violation.
 */
export function validateContent(pkg: unknown): ContentPackage {
  const parsed = ContentPackageSchema.parse(pkg);
  const issues: ValidationIssue[] = [];

  // hash.spec slot list must be non-empty and sentinel-consistent.
  if (parsed.hashSpec.slots.length === 0) {
    issues.push({ path: "hashSpec.slots", message: "empty slot list" });
  }
  if (parsed.hashSpec.slots.includes(parsed.hashSpec.sentinel)) {
    issues.push({
      path: "hashSpec.sentinel",
      message: "sentinel collides with a slot id",
    });
  }

  // origin-v2 block integrity: unique ids, exactly the A-D key letters, keyed
  // families known, escape oid distinct from the key letters, and both derived
  // slots (`<id>M`/`<id>L`) present in the hash-spec slot list.
  const blocks = parsed.originBlocks;
  const fams = new Set(blocks.families);
  if (fams.size !== blocks.families.length) {
    issues.push({ path: "originBlocks.families", message: "duplicate family" });
  }
  const slotSet = new Set(parsed.hashSpec.slots);
  const seenIds = new Set<string>();
  for (const b of blocks.blocks) {
    if (seenIds.has(b.id)) {
      issues.push({ path: `originBlocks.${b.id}`, message: "duplicate block id" });
    }
    seenIds.add(b.id);
    const letters = Object.keys(b.key).sort();
    if (letters.join(",") !== "A,B,C,D") {
      issues.push({
        path: `originBlocks.${b.id}.key`,
        message: `key letters must be exactly A-D (got ${letters.join(",")})`,
      });
    }
    if (letters.includes(blocks.escape)) {
      issues.push({
        path: `originBlocks.${b.id}.key`,
        message: "escape oid collides with a key letter",
      });
    }
    for (const [letter, fam] of Object.entries(b.key)) {
      if (!fams.has(fam)) {
        issues.push({
          path: `originBlocks.${b.id}.key.${letter}`,
          message: `unknown family ${fam}`,
        });
      }
    }
    for (const slot of [`${b.id}M`, `${b.id}L`]) {
      if (!slotSet.has(slot)) {
        issues.push({ path: "hashSpec.slots", message: `missing origin slot ${slot}` });
      }
    }
  }

  if (issues.length) {
    throw new Error(
      "content validation failed:\n" +
        issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n"),
    );
  }
  return parsed;
}

export { CopingTreeSchema, OriginBlocksSchema, HashSpecSchema };
