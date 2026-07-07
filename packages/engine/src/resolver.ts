/**
 * Deterministic hard-axes resolver (coping + origin) — a byte-faithful port of
 * the certified reference `scorer.py` (spec v0.5, Appendix A v3).
 *
 * ONE walk drives two modes:
 *  - mode "full":    a complete cold answer map is supplied up front; missing
 *                    new-v3 slots degrade exactly as the reference does. Used by
 *                    the 200-persona validation and by full-map scoring.
 *  - mode "session": answers arrive incrementally; when the walk needs an
 *                    unanswered slot it throws `Pending` (the next question to
 *                    present). New-slot degradation is disabled — the machine
 *                    asks every slot. The session driver re-runs the walk after
 *                    each answer (the walk is pure and bounded at <=22 slots).
 *
 * Every branch here maps 1:1 onto a `scorer.py` construct; deviations are none.
 */
import type { CopingTree, OriginTree, ProbeEntry } from "./schemas.js";

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
  readonly origin: OriginTree;
  readonly styleOrder: string[];
  readonly styleIndex: Record<string, number>;
  readonly stanceIndex: Record<string, number>;
  readonly pairProbe: Map<string, string>;
  readonly leakStancePairs: Set<string>;
  readonly shadowGuardMap: Map<string, string>;
  readonly newSlots: Set<string>;
  readonly precIndex: Record<string, number>;
  readonly familyCluster: Record<string, string>;
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

export function prepareTrees(coping: CopingTree, origin: OriginTree): Prepared {
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
  for (const [qid, q] of Object.entries(origin.questions)) {
    if (q.new_slot) newSlots.add(qid);
  }

  const precIndex: Record<string, number> = {};
  origin.precedence.forEach((f, i) => (precIndex[f] = i));
  const familyCluster: Record<string, string> = {};
  for (const [cluster, fams] of Object.entries(origin.clusters)) {
    for (const f of fams) familyCluster[f] = cluster;
  }

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
    precIndex,
    familyCluster,
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
export interface C1Rec {
  fired: true;
  reason: string;
  options: string[];
  chosen: string;
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
  prior: Record<string, number>;
  V: Record<string, number>;
  S: Record<string, number>;
  firedSeps: string[];
  firedDiscs: string[];
  escapedPairs: string[][];
  c1: C1Rec | null;
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
  /** administered slot -> chosen oid, for canonical hashing (O.C1 => family). */
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

  // origin
  prior: Record<string, number> = {};
  V: Record<string, number> = {};
  S: Record<string, number> = {};
  firedSeps: string[] = [];
  firedDiscs: string[] = [];
  escapedPairs: string[][] = [];
  c1: C1Rec | null = null;
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
    if (Array.isArray(raw) && qid !== "O.C1") {
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

  // --------------------------------------------------------------- origin
  origin(): void {
    const O = this.p.origin;
    const fams = O.precedence;
    const originStart = this.asked.length;

    // O-PRIOR
    const row = O.prior[this.copingStyle!]!;
    const prior: Record<string, number> = {};
    for (const f of fams) prior[f] = 0;
    for (const f of row.tier1) prior[f]! += 2;
    for (const f of row.tier2) prior[f]! += 1;
    for (const f of fams) prior[f] = Math.min(prior[f]!, 2);
    const prearm = new Set(row.prearm);
    const V: Record<string, number> = {};
    for (const f of fams) V[f] = 0;
    let c1Chosen: string | null = null;

    const S = (f: string): number => V[f]! + prior[f]!;
    const rank = (): string[] =>
      [...fams].sort((a, b) =>
        cmpTuple(
          [
            -S(a),
            -V[a]!,
            c1Chosen === a ? 0 : 1,
            -prior[a]!,
            this.p.precIndex[a]!,
          ],
          [
            -S(b),
            -V[b]!,
            c1Chosen === b ? 0 : 1,
            -prior[b]!,
            this.p.precIndex[b]!,
          ],
        ),
      );
    const applyVotes = (qid: string, oid: string): void => {
      for (const [f, pts] of Object.entries(O.questions[qid]!.options[oid]!)) {
        V[f]! += pts;
      }
      const snap: Record<string, number> = {};
      for (const f of fams) if (S(f) !== 0) snap[f] = S(f);
      this.trace.push({ after: `${qid}:${oid}`, S: snap });
    };

    const m = O.mechanism;

    // O-ROUTE (always O.R1, O.R2, O.R3; O.R3 is a v3 slot)
    for (const qid of ["O.R1", "O.R2", "O.R3"]) {
      if (this.degrade(qid)) {
        this.flag(`missing_new_slot:${qid}`);
        continue;
      }
      const oid = this.consume(qid, O.questions[qid]!.options, null, "O", "router");
      applyVotes(qid, oid);
    }

    // O-SEP (always 2 blocks)
    const firedSeps: string[] = [];
    while (firedSeps.length < m.separation_blocks) {
      let block: string | null = null;
      for (const f of rank()) {
        const b = O.cluster_block[this.p.familyCluster[f]!]!;
        if (!firedSeps.includes(b)) {
          block = b;
          break;
        }
      }
      if (block === null) break;
      const oid = this.consume(block, O.questions[block]!.options, null, "O", "separation");
      applyVotes(block, oid);
      firedSeps.push(block);
    }
    this.firedSeps = firedSeps;

    // O-DISC
    let discFires = 0;
    const firedPrimaries = new Set<string>();
    const firedDiscs: string[] = [];
    const escapedPairs: string[][] = [];
    const unresolvedEscapes = new Set<string>();
    while (discFires < m.disc_cap) {
      const ranking = rank();
      const topk = new Set(ranking.slice(0, m.liveness_top_k));
      const leader = ranking[0]!;
      const live: { pair: (typeof O.pairs)[number]; gap: number }[] = [];
      for (const pr of O.pairs) {
        if (firedPrimaries.has(pr.primary)) continue;
        const [X, Y] = pr.pair;
        if (!topk.has(X) || !topk.has(Y)) continue;
        const thr = prearm.has(pr.primary) ? m.liveness_gap_prearmed : m.liveness_gap;
        const gap = Math.abs(S(X) - S(Y));
        if (gap > thr) continue;
        if (!pr.pair.includes(leader)) {
          if (S(leader) - Math.max(S(X), S(Y)) > 2) continue;
        }
        live.push({ pair: pr, gap });
      }
      if (!live.length) break;
      live.sort((a, b) =>
        cmpTuple(
          [
            a.pair.pair.includes(leader) ? 0 : 1,
            a.pair.bank === "P" ? 0 : 1,
            a.gap,
            a.pair.num,
          ],
          [
            b.pair.pair.includes(leader) ? 0 : 1,
            b.pair.bank === "P" ? 0 : 1,
            b.gap,
            b.pair.num,
          ],
        ),
      );
      const pr = live[0]!.pair;
      const q = O.questions[pr.primary]!;
      const oid = this.consume(pr.primary, q.options, null, "O", "discriminator");
      const escaped = oid === q.escape;
      applyVotes(pr.primary, oid);
      firedPrimaries.add(pr.primary);
      firedDiscs.push(pr.primary);
      discFires++;
      if (escaped) {
        escapedPairs.push([pr.pair[0], pr.pair[1]]);
        unresolvedEscapes.add(pairKey(pr.pair[0], pr.pair[1]));
      }
      if (pr.alternate && discFires < m.disc_cap) {
        const [X, Y] = pr.pair;
        const gapAfter = Math.abs(S(X) - S(Y));
        if (escaped || gapAfter <= m.alternate_gap) {
          const aq = O.questions[pr.alternate]!;
          if (this.degrade(pr.alternate)) {
            this.flag(`missing_new_slot:${pr.alternate}`);
          } else {
            const aoid = this.consume(pr.alternate, aq.options, null, "O", "alternate");
            applyVotes(pr.alternate, aoid);
            firedDiscs.push(pr.alternate);
            discFires++;
            if (aq.escape && aoid !== aq.escape) {
              unresolvedEscapes.delete(pairKey(pr.pair[0], pr.pair[1]));
            }
          }
        }
      }
    }
    this.firedDiscs = firedDiscs;
    this.escapedPairs = escapedPairs;

    // O-CONF
    let ranking = rank();
    const r1 = ranking[0]!;
    const r2 = ranking[1]!;
    const r3 = ranking[2]!;
    const gap12 = S(r1) - S(r2);
    // answer-only leader: argmax V, ties by lowest precedence index (Prior excluded)
    const aol = minByKey(fams, (f) => [-V[f]!, this.p.precIndex[f]!]);
    const nearTie = gap12 <= m.c1_near_tie_gap;
    const decisive = aol !== r1;
    const escapedTop2 =
      m.c1_escaped_pair_trigger && unresolvedEscapes.has(pairKey(r1, r2));
    if (nearTie || decisive || escapedTop2) {
      const threeway = S(r1) - S(r3) <= m.c1_third_option_gap;
      let options: string[];
      let reason: string;
      if (decisive) {
        options = [r1];
        if (!options.includes(aol)) options.push(aol);
        if (threeway && !options.includes(r3)) options.push(r3);
        reason = "decisive-prior" + (nearTie ? "+near-tie" : "");
      } else if (nearTie) {
        options = threeway ? [r1, r2, r3] : [r1, r2];
        reason = "near-tie";
      } else {
        options = [r1, r2];
        reason = "escaped-pair";
      }
      const chosen = this.c1Choice(options);
      V[chosen]! += 2;
      c1Chosen = chosen;
      const snap: Record<string, number> = {};
      for (const f of fams) if (S(f) !== 0) snap[f] = S(f);
      this.trace.push({ after: `O.C1:${chosen}`, S: snap });
      this.tokenMap["O.C1"] = chosen;
      this.c1 = { fired: true, reason, options, chosen };
    }

    // O-RESOLVE
    ranking = rank();
    this.originFamily = ranking[0]!;
    this.originTop2 = ranking.slice(0, 2);
    this.prior = prior;
    this.V = V;
    const Sall: Record<string, number> = {};
    for (const f of fams) Sall[f] = S(f);
    this.S = Sall;
    this.originLen = this.asked.length - originStart;
  }

  private c1Choice(options: string[]): string {
    const raw = this.answers["O.C1"];
    if (raw === undefined) {
      if (this.mode === "session") {
        throw new Pending("O.C1", options, options, "O", "confirmation");
      }
      this.flag("missing_answer:O.C1");
      throw new ScorerError(
        `persona ${this.personaId}: O.C1 fired but no answer supplied`,
      );
    }
    this.asked.push(["O.C1", typeof raw === "string" ? raw : [...raw]]);
    if (typeof raw === "string") {
      const fam = raw.trim().toUpperCase();
      if (options.includes(fam)) return fam;
      this.flag("c1_answer_out_of_set");
      return [...options].sort(
        (a, b) => this.p.precIndex[a]! - this.p.precIndex[b]!,
      )[0]!;
    }
    const ordered = raw.map((x) => String(x).trim().toUpperCase());
    for (const fam of ordered) if (options.includes(fam)) return fam;
    this.flag("c1_ranking_covers_no_option");
    return [...options].sort(
      (a, b) => this.p.precIndex[a]! - this.p.precIndex[b]!,
    )[0]!;
  }

  record(): ScoreRecord {
    const nonzero = (m: Record<string, number>): Record<string, number> => {
      const o: Record<string, number> = {};
      for (const [k, v] of Object.entries(m)) if (v) o[k] = v;
      return o;
    };
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
      prior: nonzero(this.prior),
      V: nonzero(this.V),
      S: nonzero(this.S),
      firedSeps: this.firedSeps,
      firedDiscs: this.firedDiscs,
      escapedPairs: this.escapedPairs,
      c1: this.c1,
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
function minByKey<T>(items: readonly T[], key: (t: T) => number[]): T {
  let best = items[0]!;
  let bk = key(best);
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]!);
    if (cmpTuple(k, bk) < 0) {
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
