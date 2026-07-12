/**
 * Deterministic hard-axes resolver (coping + origin).
 *
 * COPING is a byte-faithful port of the certified reference `scorer.py`
 * (spec v0.5, Appendix A v3) — every branch maps 1:1 onto a `scorer.py`
 * construct; deviations are none.
 *
 * ORIGIN is the v2 recognition-block instrument (locked 2026-07-10): 14 blocks
 * N01..N14, each with a most-mine slot (`N##M`, +1 to the keyed family, escape
 * "E" votes nothing) and a least-mine slot (`N##L`, -1, must differ from M
 * unless M escaped). Resolution = per-family sum, argmax with tie-break
 * (higher M-pick count, then canonical family order). Byte-faithful port of
 * the locked `origin_v2/score_v2.py` (see DECISIONS.md D11).
 *
 * ONE walk drives two modes:
 *  - mode "full":    a complete cold answer map is supplied up front; missing
 *                    new-v3 coping slots degrade exactly as the reference does.
 *                    Used by persona validation and by full-map scoring.
 *  - mode "session": answers arrive incrementally; when the walk needs an
 *                    unanswered slot it throws `Pending` (the next question to
 *                    present). New-slot degradation is disabled — the machine
 *                    asks every slot. The session driver re-runs the walk after
 *                    each answer (the walk is pure and bounded at <=37 slots).
 */
import type { CopingTree, OriginBlocks, ProbeEntry } from "./schemas.js";

export type Mode = "full" | "session";

export type AnswerValue = string | string[];
export type AnswerMap = Record<string, AnswerValue>;

/** Thrown by the walk in session mode when it needs an unanswered slot. */
export class Pending extends Error {
  constructor(
    public readonly qid: string,
    /** all option ids of the slot (canonical order). */
    public readonly optionIds: string[],
    /** displayed subset when the slot is display-filtered, else null. */
    public readonly allowed: string[] | null,
    public readonly part: "K" | "O" | "V",
    public readonly kind: string,
  ) {
    super(`pending:${qid}`);
    this.name = "Pending";
  }
}

/** Thrown by the walk in full mode on a malformed / missing answer. */
export class ScorerError extends Error {}

// --------------------------------------------------------------- derived tables
export interface Prepared {
  readonly coping: CopingTree;
  readonly origin: OriginBlocks;
  readonly styleOrder: string[];
  readonly styleIndex: Record<string, number>;
  readonly stanceIndex: Record<string, number>;
  readonly pairProbe: Map<string, string>;
  readonly leakStancePairs: Set<string>;
  readonly shadowGuardMap: Map<string, string>;
  readonly newSlots: Set<string>;
  /** family -> index in the canonical tie-break order (origin.families). */
  readonly famIndex: Record<string, number>;
}

const pairKey = (a: string, b: string): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

/** Option letters of a probe entry (everything except metadata keys). */
export function probeOptions(entry: ProbeEntry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k === "category" || k === "new_slot") continue;
    out[k] = v as string;
  }
  return out;
}

export function prepareTrees(coping: CopingTree, origin: OriginBlocks): Prepared {
  const styleOrder: string[] = [];
  for (const stance of coping.stance_prior_order) {
    const block = coping.block_prior_order[stance];
    if (block) styleOrder.push(...block);
  }
  const styleIndex: Record<string, number> = {};
  styleOrder.forEach((s, i) => (styleIndex[s] = i));
  const stanceIndex: Record<string, number> = {};
  coping.stance_prior_order.forEach((s, i) => (stanceIndex[s] = i));

  const pairProbe = new Map<string, string>();
  for (const e of coping.listed_pairs) {
    pairProbe.set(pairKey(e.pair[0], e.pair[1]), e.probe);
  }
  const leakStancePairs = new Set<string>();
  for (const p of coping.stance_leak_rows) {
    leakStancePairs.add(pairKey(p[0], p[1]));
  }
  const shadowGuardMap = new Map<string, string>();
  for (const r of coping.shadow_guards) {
    shadowGuardMap.set(`${r.style}|${r.shadow}`, r.probe);
  }

  const newSlots = new Set<string>();
  for (const [qid, q] of Object.entries(coping.probes)) {
    if (q.new_slot) newSlots.add(qid);
  }

  const famIndex: Record<string, number> = {};
  origin.families.forEach((f, i) => (famIndex[f] = i));

  return {
    coping,
    origin,
    styleOrder,
    styleIndex,
    stanceIndex,
    pairProbe,
    leakStancePairs,
    shadowGuardMap,
    newSlots,
    famIndex,
  };
}

// --------------------------------------------------------------- record type
export interface TieResolverRec {
  qid: string;
  oid: string | null;
  voted: string | null;
  abstained?: boolean;
}
export interface GuardRec {
  qid: string;
  oid: string;
  outcome: "confirm" | "flip";
  from: string;
  to: string;
}
export interface TraceEntry {
  after: string;
  S: Record<string, number>;
}
export interface ScoreRecord {
  personaId: string;
  askedPath: string[];
  pathLength: number;
  copingPathLength: number;
  originPathLength: number;
  r4Fired: boolean;
  stanceVotes: Record<string, number>;
  enteredBlock: string | null;
  shadowStance: string | null;
  coreTally: Record<string, number>;
  styleVotes: Record<string, number>;
  tieResolver: TieResolverRec | null;
  guard: GuardRec | null;
  copingStyle: string | null;
  copingTrueStance: string | null;
  copingConfidence: string | null;
  copingRunnerUp: string | null;
  /** origin v2: final per-family sum S (all families, zeros included). */
  originSums: Record<string, number>;
  /** origin v2: per-family M-pick counts (the first tie-break key). */
  originMostCounts: Record<string, number>;
  originFamily: string | null;
  originTop2: string[];
  originRunnerUp: string | null;
  cell: [string | null, string | null];
  flags: string[];
}

// --------------------------------------------------------------- the walker
export class Walker {
  readonly asked: [string, AnswerValue][] = [];
  readonly flags: string[] = [];
  readonly trace: TraceEntry[] = [];
  /** administered slot -> chosen oid, for canonical hashing. */
  readonly tokenMap: Record<string, string> = {};

  // coping
  stanceVotes: Record<string, number> = {};
  r4Fired = false;
  enteredBlock: string | null = null;
  shadowStance: string | null = null;
  coreTally: Record<string, number> = {};
  styleVotes: Record<string, number> = {};
  tieResolver: TieResolverRec | null = null;
  guard: GuardRec | null = null;
  firedProbes = new Set<string>();
  copingStyle: string | null = null;
  copingStance: string | null = null;
  copingConfidence: string | null = null;
  copingRunnerUp: string | null = null;
  copingLen = 0;

  // origin (v2 sum walk)
  originSums: Record<string, number> = {};
  originMostCounts: Record<string, number> = {};
  originFamily: string | null = null;
  originTop2: string[] = [];
  originLen = 0;

  constructor(
    readonly p: Prepared,
    readonly personaId: string,
    readonly answers: AnswerMap,
    readonly mode: Mode,
  ) {}

  flag(msg: string): void {
    this.flags.push(msg);
  }

  /** true iff (full mode) a new slot is absent from the supplied map. */
  private degrade(qid: string): boolean {
    return (
      this.mode === "full" &&
      this.p.newSlots.has(qid) &&
      !(qid in this.answers)
    );
  }

  /**
   * Consume an answer for `qid`. `allowed` (display filter) only constrains
   * ranking-list answers, matching the reference `_State.consume`.
   */
  consume(
    qid: string,
    options: Record<string, string> | Record<string, Record<string, number>>,
    allowed: Set<string> | null = null,
    part: "K" | "O" | "V" = "K",
    kind = "",
  ): string {
    const raw = this.answers[qid];
    if (raw === undefined) {
      if (this.mode === "session") {
        throw new Pending(
          qid,
          Object.keys(options),
          allowed ? [...allowed] : null,
          part,
          kind,
        );
      }
      this.flag(`missing_answer:${qid}`);
      throw new ScorerError(
        `persona ${this.personaId}: tree asks ${qid} but no answer supplied`,
      );
    }
    if (Array.isArray(raw)) {
      for (const cand of raw) {
        const c = String(cand);
        if (c in options && (allowed === null || allowed.has(c))) {
          this.asked.push([qid, c]);
          this.tokenMap[qid] = c;
          return c;
        }
      }
      this.flag(`ranking_covers_no_option:${qid}`);
      throw new ScorerError(
        `persona ${this.personaId}: ${qid} ranking covers no displayable option`,
      );
    }
    if (typeof raw !== "string" || !(raw in options)) {
      throw new ScorerError(
        `persona ${this.personaId}: ${qid} answer ${JSON.stringify(raw)} not a valid option`,
      );
    }
    this.asked.push([qid, raw]);
    this.tokenMap[qid] = raw;
    return raw;
  }

  private argmaxStyle(votes: Record<string, number>): string {
    let best: string | null = null;
    for (const s of Object.keys(votes)) {
      if (
        best === null ||
        votes[s]! > votes[best]! ||
        (votes[s]! === votes[best]! &&
          this.p.styleIndex[s]! < this.p.styleIndex[best]!)
      ) {
        best = s;
      }
    }
    return best!;
  }

  private blockPriorRunnerUp(stance: string, resolved: string): string | null {
    for (const s of this.p.coping.block_prior_order[stance] ?? []) {
      if (s !== resolved) return s;
    }
    return null;
  }

  private tiedRunnerUp(
    losers: string[],
    winner: string,
    stance: string,
  ): string {
    const block = this.p.coping.block_prior_order[stance] ?? [];
    const key = (s: string): [number, number, number, number] => {
      const aff = this.p.pairProbe.has(pairKey(s, winner)) ? 1 : 0;
      const inBlock = block.includes(s) ? 0 : 1;
      const bp = block.includes(s) ? block.indexOf(s) : block.length;
      return [-aff, inBlock, bp, this.p.styleIndex[s]!];
    };
    return [...losers].sort((a, b) => cmpTuple(key(a), key(b)))[0]!;
  }

  // --------------------------------------------------------------- coping
  coping(): void {
    const K = this.p.coping;

    // K-ROUTE
    const stanceVotes: Record<string, number> = {};
    for (const qid of ["K.R1", "K.R2", "K.R3"]) {
      const oid = this.consume(qid, K.routers[qid]!, null, "K", "router");
      const stance = K.routers[qid]![oid]!;
      stanceVotes[stance] = (stanceVotes[stance] ?? 0) + 1;
    }
    this.stanceVotes = stanceVotes;

    const top = Math.max(...Object.values(stanceVotes));
    let entered: string;
    let shadow: string | null;
    if (top >= 2) {
      entered = maxByKey(Object.keys(stanceVotes), (s) => [
        stanceVotes[s]!,
        -this.p.stanceIndex[s]!,
      ]);
      const losers = Object.keys(stanceVotes).filter(
        (s) => s !== entered && stanceVotes[s] === 1,
      );
      shadow = losers.length ? losers[0]! : null;
      this.r4Fired = false;
    } else {
      // 1/1/1 -> K.R4, display filtered to the 3 tied stances
      const tied = Object.keys(stanceVotes).sort(
        (a, b) => this.p.stanceIndex[a]! - this.p.stanceIndex[b]!,
      );
      const r4opts = K.routers["K.R4"]!;
      const allowed = new Set(
        Object.keys(r4opts).filter((o) => tied.includes(r4opts[o]!)),
      );
      const oid = this.consume("K.R4", r4opts, allowed, "K", "router");
      let voted = r4opts[oid]!;
      const affTo = (target: string, s: string): number =>
        this.p.leakStancePairs.has(pairKey(s, target)) ? 1 : 0;
      if (!tied.includes(voted)) {
        this.flag("filter_violation:K.R4");
        voted = [...tied].sort((a, b) =>
          cmpTuple(
            [-affTo(voted, a), this.p.stanceIndex[a]!],
            [-affTo(voted, b), this.p.stanceIndex[b]!],
          ),
        )[0]!;
      }
      stanceVotes[voted] = (stanceVotes[voted] ?? 0) + 1;
      entered = voted;
      const losers = tied
        .filter((s) => s !== entered)
        .sort((a, b) =>
          cmpTuple(
            [-affTo(entered, a), this.p.stanceIndex[a]!],
            [-affTo(entered, b), this.p.stanceIndex[b]!],
          ),
        );
      shadow = losers.length ? losers[0]! : null;
      this.r4Fired = true;
    }
    this.enteredBlock = entered;
    this.shadowStance = shadow;

    // K-BLOCK (3 cores, listed order)
    const styleVotes: Record<string, number> = {};
    for (const qid of K.block_cores[entered]!) {
      const oid = this.consume(qid, K.cores[qid]!, null, "K", "core");
      const style = K.cores[qid]![oid]!;
      styleVotes[style] = (styleVotes[style] ?? 0) + 1;
    }
    this.coreTally = { ...styleVotes };

    // K-TIE
    let resolver: TieResolverRec | null = null;
    let confidence: string | null = null;
    let runnerUp: string | null = null;
    let resolved: string;
    const tally = Object.entries(styleVotes).sort((a, b) =>
      cmpTuple(
        [-a[1], this.p.styleIndex[a[0]]!],
        [-b[1], this.p.styleIndex[b[0]]!],
      ),
    );
    if (tally[0]![1] === 3) {
      resolved = tally[0]![0];
      confidence = "HIGH";
      runnerUp = this.blockPriorRunnerUp(entered, resolved);
    } else if (tally[0]![1] === 2) {
      const leader = tally[0]![0];
      const other = tally[1]![0];
      const probe = this.p.pairProbe.get(pairKey(leader, other)) ?? null;
      const [rq, ropts, display] = this.pickResolver(
        entered,
        probe,
        new Set([leader, other]),
      );
      if (rq === null) {
        resolver = { qid: probe!, oid: null, voted: null, abstained: true };
        resolved = leader;
        confidence = "MODERATE";
        runnerUp = other;
      } else {
        const allowed =
          display === null
            ? null
            : new Set(
                Object.keys(ropts!).filter((o) =>
                  display.has(ropts![o] as string),
                ),
              );
        const oid = this.consume(rq, ropts!, allowed, "K", "tiebreak");
        const voted = ropts![oid] as string;
        if (display !== null && !display.has(voted)) {
          this.flag(`filter_violation:${rq}`);
          resolver = { qid: rq, oid, voted, abstained: true };
          resolved = leader;
          confidence = "MODERATE";
          runnerUp = other;
        } else {
          styleVotes[voted] = (styleVotes[voted] ?? 0) + 2;
          if (rq.startsWith("K.P")) this.firedProbes.add(rq);
          resolver = { qid: rq, oid, voted };
          resolved = this.argmaxStyle(styleVotes);
          confidence = resolved === leader && voted === leader ? "HIGH" : "MODERATE";
          if (resolved === leader || resolved === other) {
            runnerUp = resolved === leader ? other : leader;
          } else {
            runnerUp = leader;
            this.flag("resolver_winner_outside_tie");
          }
        }
      }
    } else {
      // 1-1-1
      const tied = Object.keys(styleVotes).filter((s) => styleVotes[s] === 1);
      let probe: string | null = null;
      for (const ck of K.cross_keys[entered] ?? []) {
        if (tied.includes(ck.style) && tied.includes(ck.partner)) {
          probe = ck.probe;
          break;
        }
      }
      const [rq, ropts, display] = this.pickResolver(
        entered,
        probe,
        new Set(tied),
      );
      const leader0 = this.argmaxStyle(styleVotes);
      if (rq === null) {
        resolver = { qid: probe!, oid: null, voted: null, abstained: true };
        resolved = leader0;
        confidence = "MODERATE";
        const losers = tied.filter((s) => s !== resolved);
        runnerUp = this.tiedRunnerUp(losers.length ? losers : tied, resolved, entered);
      } else {
        const allowed =
          display === null
            ? null
            : new Set(
                Object.keys(ropts!).filter((o) =>
                  display.has(ropts![o] as string),
                ),
              );
        const oid = this.consume(rq, ropts!, allowed, "K", "tiebreak");
        const voted = ropts![oid] as string;
        if (display !== null && !display.has(voted)) {
          this.flag(`filter_violation:${rq}`);
          resolver = { qid: rq, oid, voted, abstained: true };
          resolved = leader0;
        } else {
          styleVotes[voted] = (styleVotes[voted] ?? 0) + 2;
          if (rq.startsWith("K.P")) this.firedProbes.add(rq);
          resolver = { qid: rq, oid, voted };
          resolved = this.argmaxStyle(styleVotes);
        }
        confidence = "MODERATE";
        let losers = tied.filter((s) => s !== resolved);
        if (!losers.length) {
          losers = tied;
          this.flag("resolver_winner_outside_tie");
        }
        runnerUp = this.tiedRunnerUp(losers, resolved, entered);
      }
    }
    this.styleVotes = { ...styleVotes };
    this.tieResolver = resolver;

    // K-GUARD (priority mask > shadow > function; skip if probe already fired)
    let guardProbe: string | null = null;
    const maskProbe = K.mask_guards[resolved];
    if (maskProbe !== undefined) {
      guardProbe = this.firedProbes.has(maskProbe) ? null : maskProbe;
    } else {
      const gp = this.p.shadowGuardMap.get(`${resolved}|${shadow}`);
      if (gp !== undefined && !this.firedProbes.has(gp)) {
        guardProbe = gp;
      } else {
        const fp = K.function_guards[resolved];
        if (fp !== undefined && !this.firedProbes.has(fp)) guardProbe = fp;
      }
    }
    if (guardProbe !== null && this.degrade(guardProbe)) {
      // unanswered new guard = confirm (free re-score degradation)
      this.flag(`missing_new_slot:${guardProbe}`);
      guardProbe = null;
    }
    if (guardProbe !== null) {
      const gopts = probeOptions(K.probes[guardProbe]!);
      const oid = this.consume(guardProbe, gopts, null, "K", "probe");
      const gstyle = gopts[oid]!;
      this.firedProbes.add(guardProbe);
      if (gstyle === resolved) {
        this.guard = {
          qid: guardProbe,
          oid,
          outcome: "confirm",
          from: resolved,
          to: resolved,
        };
      } else {
        this.guard = {
          qid: guardProbe,
          oid,
          outcome: "flip",
          from: resolved,
          to: gstyle,
        };
        runnerUp = resolved;
        resolved = gstyle;
        confidence = "MODERATE";
      }
    }

    // K-RESOLVE
    this.copingStyle = resolved;
    this.copingStance = K.style_stance[resolved]!;
    this.copingConfidence = confidence;
    this.copingRunnerUp = runnerUp;
    this.copingLen = this.asked.length;
  }

  /** Returns [qid, options, display] or [null, null, null] (full-mode degrade). */
  private pickResolver(
    entered: string,
    probe: string | null,
    tiedSet: Set<string>,
  ): [string, Record<string, string>, Set<string> | null] | [null, null, null] {
    const K = this.p.coping;
    if (probe !== null) {
      if (this.degrade(probe)) {
        this.flag(`missing_new_slot:${probe}`);
        const rq = K.block_tiebreak[entered]!;
        if (rq in this.answers) {
          this.flag(`resolver_fallback:${probe}->${rq}`);
          return [rq, K.tiebreaks[rq]!, tiedSet];
        }
        return [null, null, null];
      }
      return [probe, probeOptions(K.probes[probe]!), null];
    }
    const rq = K.block_tiebreak[entered]!;
    return [rq, K.tiebreaks[rq]!, tiedSet];
  }

  // --------------------------------------------------------------- origin (v2)
  /**
   * Origin v2 sum walk — a 1:1 port of `origin_v2/score_v2.py`:
   * for each block N01..N14 ask `<id>M` (A-D vote +1, escape votes nothing)
   * then `<id>L` (A-D vote -1, must differ from M unless M escaped), then
   * argmax over S with tie-break (higher M-pick count, canonical order).
   * No coping prior, no routers/separations/discriminators/confirmation.
   */
  origin(): void {
    const O = this.p.origin;
    const fams = O.families;
    const originStart = this.asked.length;

    const S: Record<string, number> = {};
    const most: Record<string, number> = {};
    for (const f of fams) {
      S[f] = 0;
      most[f] = 0;
    }

    for (const b of O.blocks) {
      const letters = Object.keys(b.key).sort();

      // <id>M — most-mine (+1), escape oid allowed and votes nothing.
      const mOptions: Record<string, string> = {};
      for (const l of letters) mOptions[l] = b.key[l]!;
      mOptions[O.escape] = "ESCAPE";
      const m = this.consume(`${b.id}M`, mOptions, null, "O", "most");
      if (m !== O.escape) {
        S[b.key[m]!]! += 1;
        most[b.key[m]!]! += 1;
      }

      // <id>L — least-mine (-1); the M pick is display-filtered out unless
      // M escaped (session UI never offers it; full mode rejects it below).
      const lOptions: Record<string, string> = {};
      for (const l of letters) lOptions[l] = b.key[l]!;
      const allowed =
        m === O.escape ? null : new Set(letters.filter((x) => x !== m));
      const l = this.consume(`${b.id}L`, lOptions, allowed, "O", "least");
      if (m !== O.escape && l === m) {
        this.flag(`ml_conflict:${b.id}`);
        throw new ScorerError(
          `persona ${this.personaId}: ${b.id} least pick equals most pick`,
        );
      }
      S[b.key[l]!]! -= 1;

      const snap: Record<string, number> = {};
      for (const f of fams) if (S[f] !== 0) snap[f] = S[f]!;
      this.trace.push({ after: `${b.id}:${m}${l}`, S: snap });
    }

    // O-RESOLVE: argmax S; ties by higher M-pick count, then canonical order.
    const ranking = [...fams].sort((a, b) =>
      cmpTuple(
        [-S[a]!, -most[a]!, this.p.famIndex[a]!],
        [-S[b]!, -most[b]!, this.p.famIndex[b]!],
      ),
    );
    this.originFamily = ranking[0]!;
    this.originTop2 = ranking.slice(0, 2);
    this.originSums = { ...S };
    this.originMostCounts = { ...most };
    this.originLen = this.asked.length - originStart;
  }

  record(): ScoreRecord {
    return {
      personaId: this.personaId,
      askedPath: this.asked.map(([q, o]) =>
        typeof o === "string" ? `${q}:${o}` : `${q}:${o.join("+")}`,
      ),
      pathLength: this.asked.length,
      copingPathLength: this.copingLen,
      originPathLength: this.originLen,
      r4Fired: this.r4Fired,
      stanceVotes: this.stanceVotes,
      enteredBlock: this.enteredBlock,
      shadowStance: this.shadowStance,
      coreTally: this.coreTally,
      styleVotes: this.styleVotes,
      tieResolver: this.tieResolver,
      guard: this.guard,
      copingStyle: this.copingStyle,
      copingTrueStance: this.copingStance,
      copingConfidence: this.copingConfidence,
      copingRunnerUp: this.copingRunnerUp,
      originSums: { ...this.originSums },
      originMostCounts: { ...this.originMostCounts },
      originFamily: this.originFamily,
      originTop2: this.originTop2,
      originRunnerUp: this.originTop2.length > 1 ? this.originTop2[1]! : null,
      cell: [this.originFamily, this.copingStyle],
      flags: this.flags,
    };
  }
}

// --------------------------------------------------------------- helpers
function cmpTuple(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}
function maxByKey<T>(items: readonly T[], key: (t: T) => number[]): T {
  let best = items[0]!;
  let bk = key(best);
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]!);
    if (cmpTuple(k, bk) > 0) {
      best = items[i]!;
      bk = k;
    }
  }
  return best;
}
/** Full-map hard-axes resolution (validation path). */
export function resolveHardAxes(
  prepared: Prepared,
  personaId: string,
  answers: AnswerMap,
): { record: ScoreRecord; walker: Walker } {
  const w = new Walker(prepared, personaId, answers, "full");
  w.coping();
  w.origin();
  return { record: w.record(), walker: w };
}
