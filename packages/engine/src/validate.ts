/**
 * Content validation helpers. The compiler calls these to fail loudly before
 * writing; a runtime host may call them on load. Thin wrappers around the zod
 * schemas plus a couple of cross-file invariants the schemas can't express.
 */
import {
  ContentPackageSchema,
  CopingTreeSchema,
  OriginTreeSchema,
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

  // every coping style referenced by the prior table must be a real style.
  const styles = new Set(Object.keys(parsed.copingTree.style_stance));
  for (const s of Object.keys(parsed.originTree.prior)) {
    if (!styles.has(s)) {
      issues.push({ path: `originTree.prior.${s}`, message: "unknown coping style" });
    }
  }
  for (const s of styles) {
    if (!(s in parsed.originTree.prior)) {
      issues.push({ path: `originTree.prior.${s}`, message: "missing prior row for style" });
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

export { CopingTreeSchema, OriginTreeSchema, HashSpecSchema };
