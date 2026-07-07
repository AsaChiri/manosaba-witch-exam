/**
 * Session-based public API (spec §1–§4). Drives the deterministic state machine
 * one question at a time so a UI can present stems/options and feed answers back.
 *
 * The hard-axes walk (coping + origin) is re-run after every answer — it is pure
 * and bounded at <=22 slots, so re-running is trivial and guarantees the session
 * and the full-map validation path resolve identically. After O-RESOLVE the
 * session composes the pick screens (cell-route -> V.OGROUP/V.OPICK/V.CPICK),
 * then serves a tag + variant + answer-vector hash.
 */
import type { ContentPackage } from "./schemas.js";
import {
  prepareTrees,
  Walker,
  Pending,
  type Prepared,
  type AnswerMap,
} from "./resolver.js";
import { canonicalString, fnv1a32String } from "./hash.js";
import { permute } from "./permute.js";
import { cellKey, pickPairKey, parseCellKey } from "./keys.js";
import { selectVariant } from "./tags.js";

export type Phase = "coping" | "origin" | "picks";

export interface QuestionInstance {
  qid: string;
  part: "K" | "O" | "V";
  kind: string;
  phase: Phase;
  /** display stem (from strings, else the stemKey, else the qid). */
  stem: string;
  /** options in display order (permuted for pick screens). */
  options: { oid: string; text: string }[];
}

export interface ExamResult {
  style: string;
  trueStance: string;
  confidence: string;
  runnerUp: string | null;
  family: string;
  top2: [string, string];
  cell: { family: string; style: string };
  redirectedCell?: { family: string; style: string };
  picks: { o: string; c: string };
  originGroup?: string;
  tag: string;
  tier: number;
  variantIndex: number;
  answersHash: number;
  canonicalString: string;
}

export interface CreateExamOptions {
  /** locale for display text; must exist in content.strings if provided. */
  locale?: string;
}

export interface ExamSession {
  current(): QuestionInstance | null;
  answer(oid: string): void;
  canGoBack(): boolean;
  back(): void;
  progress(): { phase: Phase; answeredCount: number };
  isDone(): boolean;
  result(): ExamResult;
}

export class ExamError extends Error {}

type Step =
  | { kind: "question"; q: QuestionInstance }
  | { kind: "done"; result: ExamResult };

const phaseOf = (part: "K" | "O" | "V"): Phase =>
  part === "K" ? "coping" : part === "O" ? "origin" : "picks";

export function createExam(
  content: ContentPackage,
  opts: CreateExamOptions = {},
): ExamSession {
  const prepared: Prepared = prepareTrees(content.copingTree, content.originTree);
  return new Session(content, prepared, opts);
}

class Session implements ExamSession {
  private readonly answers: AnswerMap = {};
  private readonly history: string[] = [];
  private cached: Step | null = null;

  constructor(
    private readonly content: ContentPackage,
    private readonly prepared: Prepared,
    private readonly opts: CreateExamOptions,
  ) {}

  private step(): Step {
    if (this.cached === null) this.cached = this.compute();
    return this.cached;
  }

  current(): QuestionInstance | null {
    const s = this.step();
    return s.kind === "question" ? s.q : null;
  }

  answer(oid: string): void {
    const s = this.step();
    if (s.kind !== "question") throw new ExamError("exam is already complete");
    const valid = s.q.options.some((o) => o.oid === oid);
    if (!valid) {
      throw new ExamError(
        `option ${oid} is not offered for ${s.q.qid}`,
      );
    }
    this.answers[s.q.qid] = oid;
    this.history.push(s.q.qid);
    this.cached = null;
  }

  canGoBack(): boolean {
    return this.history.length > 0;
  }

  back(): void {
    const last = this.history.pop();
    if (last === undefined) throw new ExamError("nothing to undo");
    delete this.answers[last];
    this.cached = null;
  }

  progress(): { phase: Phase; answeredCount: number } {
    const s = this.step();
    const phase: Phase = s.kind === "done" ? "picks" : s.q.phase;
    return { phase, answeredCount: this.history.length };
  }

  isDone(): boolean {
    return this.step().kind === "done";
  }

  result(): ExamResult {
    const s = this.step();
    if (s.kind !== "done") throw new ExamError("exam is not complete");
    return s.result;
  }

  // ---------------------------------------------------------------- internals
  private text(qid: string, oid: string): string {
    const q = this.content.strings?.questions[qid];
    return q?.options[oid] ?? oid;
  }
  private stemText(qid: string): string {
    return (
      this.content.strings?.questions[qid]?.stem ??
      this.content.questions?.[qid]?.stemKey ??
      qid
    );
  }

  private compute(): Step {
    // 1. Hard-axes walk (session mode): pends on the next unanswered K/O slot.
    const w = new Walker(this.prepared, "session", this.answers, "session");
    try {
      w.coping();
      w.origin();
    } catch (e) {
      if (e instanceof Pending) return this.questionFromPending(e);
      throw e;
    }
    // 2. Tail: cell-route + picks + tag + variant.
    return this.tail(w);
  }

  private questionFromPending(p: Pending): Step {
    const optionIds = p.allowed ?? p.optionIds;
    return {
      kind: "question",
      q: {
        qid: p.qid,
        part: p.part,
        kind: p.kind,
        phase: phaseOf(p.part),
        stem: this.stemText(p.qid),
        options: optionIds.map((oid) => ({ oid, text: this.text(p.qid, oid) })),
      },
    };
  }

  private pickQuestion(
    qid: string,
    kind: string,
    composed: string[],
    seed: string,
  ): Step {
    const order = permute(composed, seed);
    return {
      kind: "question",
      q: {
        qid,
        part: "V",
        kind,
        phase: "picks",
        stem: this.stemText(qid),
        options: order.map((oid) => ({ oid, text: this.text(qid, oid) })),
      },
    };
  }

  private tail(w: Walker): Step {
    const family = w.originFamily!;
    const style = w.copingStyle!;
    const rawKey = cellKey(family, style);

    const picksets = this.content.picksets;
    const neighbor = this.content.neighbor;
    if (!picksets || !neighbor) {
      throw new ExamError("content is missing picksets/neighbor (needed for the pick tail)");
    }
    const redirect = picksets.redirect[rawKey];
    const landedKey = redirect ?? rawKey;
    const pickset = picksets.cells[landedKey];
    if (!pickset) {
      throw new ExamError(
        `landed cell ${landedKey} has no authored coverage (uncovered soft-launch cell)`,
      );
    }

    // pre-pick seed string = canonical serialization of the K.*/O.* slots only.
    const prePick = this.prePickString(w);

    // ---- origin axis ----
    let originPick: string;
    let oShown: boolean;
    let groupFired = false;
    let chosenGroup: string | undefined;
    const originAxis = pickset.origin;
    if ("twoStage" in originAxis) {
      const groups = originAxis.twoStage.groups;
      if (this.answers["V.OGROUP"] === undefined) {
        return this.pickQuestion("V.OGROUP", "group", groups.map((g) => g.gid), prePick);
      }
      groupFired = true;
      chosenGroup = this.answers["V.OGROUP"] as string;
      const group = groups.find((g) => g.gid === chosenGroup);
      if (!group) throw new ExamError(`unknown group ${chosenGroup} for ${landedKey}`);
      const members = group.options;
      if (members.length === 1) {
        originPick = members[0]!;
        oShown = false;
      } else if (this.answers["V.OPICK"] === undefined) {
        return this.pickQuestion(
          "V.OPICK",
          "pick",
          members,
          `${prePick}|V.OGROUP:${chosenGroup}`,
        );
      } else {
        originPick = this.answers["V.OPICK"] as string;
        oShown = true;
      }
    } else if ("auto" in originAxis) {
      originPick = originAxis.auto;
      oShown = false;
    } else {
      if (this.answers["V.OPICK"] === undefined) {
        return this.pickQuestion("V.OPICK", "pick", originAxis.options, prePick);
      }
      originPick = this.answers["V.OPICK"] as string;
      oShown = true;
    }

    // ---- coping axis (always single screen) ----
    let copingPick: string;
    let cShown: boolean;
    const copingAxis = pickset.coping;
    if ("auto" in copingAxis) {
      copingPick = copingAxis.auto;
      cShown = false;
    } else if ("twoStage" in copingAxis) {
      // not used for coping in v3 (largest style = 6), but handled defensively.
      throw new ExamError("two-stage coping axis is not supported");
    } else {
      if (this.answers["V.CPICK"] === undefined) {
        return this.pickQuestion("V.CPICK", "pick", copingAxis.options, prePick);
      }
      copingPick = this.answers["V.CPICK"] as string;
      cShown = true;
    }

    // ---- tag + variant ----
    const cellNeighbor = neighbor[landedKey];
    if (!cellNeighbor) throw new ExamError(`neighbor table missing for ${landedKey}`);
    const tagKey = pickPairKey(originPick, copingPick);
    const tag = cellNeighbor.table[tagKey];
    if (!tag) {
      throw new ExamError(
        `no served tag for picked pair ${tagKey} in cell ${landedKey}`,
      );
    }
    const tier = cellNeighbor.tiers?.[tagKey] ?? 0;

    // canonical 89-slot string: administered K/O (+O.C1) + fired pick tokens.
    const tokens: Record<string, string> = { ...w.tokenMap };
    if (groupFired && chosenGroup) tokens["V.OGROUP"] = chosenGroup;
    if (oShown) tokens["V.OPICK"] = originPick;
    if (cShown) tokens["V.CPICK"] = copingPick;
    const canon = canonicalString(tokens, this.content.hashSpec.slots, this.content.hashSpec.sentinel);
    const hash = fnv1a32String(canon);
    const n = this.content.hashSpec.variantCounts[tag] ?? 1;
    const variantIndex = selectVariant(hash, n);

    const result: ExamResult = {
      style,
      trueStance: w.copingStance!,
      confidence: w.copingConfidence!,
      runnerUp: w.copingRunnerUp,
      family,
      top2: [w.originTop2[0]!, w.originTop2[1]!],
      cell: { family, style },
      picks: { o: originPick, c: copingPick },
      tag,
      tier,
      variantIndex,
      answersHash: hash >>> 0,
      canonicalString: canon,
    };
    if (redirect) result.redirectedCell = parseCellKey(landedKey);
    if (groupFired && chosenGroup) result.originGroup = chosenGroup;
    return { kind: "done", result };
  }

  private prePickString(w: Walker): string {
    const slots = this.content.hashSpec.slots.filter(
      (s) => s.startsWith("K.") || s.startsWith("O."),
    );
    return canonicalString(w.tokenMap, slots, this.content.hashSpec.sentinel);
  }
}
