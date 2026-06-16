/* eslint-disable @typescript-eslint/no-explicit-any */
// The AUTO-BET ENGINE.
//
// Each person can set ONE standing rule ("always back the draw", "back my own
// teams", "back the favorite", ...). runAutoBets() walks every active rule and,
// for each eligible upcoming match, either JOINS an existing pool whose target
// spot is open and affordable, or OPENS a fresh pool. Everything is idempotent:
// a person is committed to a match at most once (one placement row, and we never
// double up on a match they already hold a spot in).
//
// The placement order is deterministic — rules by person_id ASC, matches by
// kickoff ASC — so that when two people's targets collide on the same match, the
// lower person_id reliably OPENS the pool and the higher one JOINS it.
import { db } from "./db";
import { deVig, type Outcome } from "./betting";
import { createPool, takeSpot, cancelPool, getOpenPoolsForMatch } from "./bets";

const nowIso = () => new Date().toISOString();

export type AutoBetCriteria =
  | "draw"
  | "my_teams"
  | "home"
  | "away"
  | "favorite"
  | "underdog";

export interface AutoBetRule {
  id: number;
  personId: number;
  criteria: AutoBetCriteria;
  stake: number;
  horizonDays: number;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

// ---- Rule storage -------------------------------------------------------------

function shapeRule(r: any): AutoBetRule {
  return {
    id: Number(r.id),
    personId: Number(r.person_id),
    criteria: r.criteria as AutoBetCriteria,
    stake: Number(r.stake),
    horizonDays: Number(r.horizon_days),
    active: Number(r.active) === 1,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

export async function getRule(personId: number): Promise<AutoBetRule | null> {
  const r = (
    await db.execute({ sql: "SELECT * FROM auto_bet_rules WHERE person_id = ?", args: [personId] })
  ).rows[0] as any;
  return r ? shapeRule(r) : null;
}

// Upsert: one rule per person.
export async function setRule(opts: {
  personId: number;
  criteria: AutoBetCriteria;
  stake: number;
  horizonDays?: number;
  active?: boolean;
}): Promise<void> {
  const { personId, criteria, stake } = opts;
  const horizonDays = opts.horizonDays ?? 2;
  const active = opts.active ?? true;
  const ts = nowIso();
  await db.execute({
    sql: `INSERT INTO auto_bet_rules
            (person_id, criteria, stake, horizon_days, active, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(person_id) DO UPDATE SET
            criteria   = excluded.criteria,
            stake      = excluded.stake,
            horizon_days = excluded.horizon_days,
            active     = excluded.active,
            updated_at = excluded.updated_at`,
    args: [personId, criteria, stake, horizonDays, active ? 1 : 0, ts, ts],
  });
}

// ---- Target-outcome logic -----------------------------------------------------

interface MatchRow {
  id: number;
  status: string;
  kickoff_utc: string | null;
  odds_home: string | null;
  odds_draw: string | null;
  odds_away: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  home_owner: number | null;
  away_owner: number | null;
  home_name: string | null;
  away_name: string | null;
}

// Given a rule's criteria + a match, the person's target Outcome (or null = skip).
function targetOutcome(criteria: AutoBetCriteria, personId: number, m: MatchRow): Outcome | null {
  switch (criteria) {
    case "draw":
      return "draw";
    case "home":
      return "home";
    case "away":
      return "away";
    case "favorite":
    case "underdog": {
      const probs = deVig({ home: m.odds_home, draw: m.odds_draw, away: m.odds_away });
      if (!probs) return null;
      // Favorite = the team side with the higher win prob; underdog = lower.
      // Draw is never a team side. Tie policy: on an exact prob tie, BOTH
      // favorite and underdog resolve to "home" (via >= / <=).
      return criteria === "favorite"
        ? probs.home >= probs.away
          ? "home"
          : "away"
        : probs.home <= probs.away
          ? "home"
          : "away";
    }
    case "my_teams": {
      const ownsHome = m.home_owner != null && Number(m.home_owner) === personId;
      const ownsAway = m.away_owner != null && Number(m.away_owner) === personId;
      if (ownsHome && !ownsAway) return "home";
      if (ownsAway && !ownsHome) return "away";
      return null; // owns both or neither -> skip
    }
  }
}

// ---- Eligibility --------------------------------------------------------------

const MATCH_SELECT = /* sql */ `
  SELECT m.id, m.status, m.kickoff_utc, m.odds_home, m.odds_draw, m.odds_away,
         m.home_team_id, m.away_team_id, m.home_name, m.away_name,
         ht.owner_id AS home_owner, at.owner_id AS away_owner
  FROM matches m
  LEFT JOIN teams ht ON ht.id = m.home_team_id
  LEFT JOIN teams at ON at.id = m.away_team_id
`;

// kickoff_utc is stored minute-precision, bare-Z (e.g. "2026-06-13T19:00Z"), and
// the WHERE clause compares it as a STRING. Build the window bounds in the exact
// same textual format ("...THH:MMZ") so the lexicographic comparison is precise —
// otherwise the default `.toISOString()` ("...:00.000Z") skews the edge, wrongly
// dropping an exact-edge kickoff and leaking ~1 minute past the horizon.
const toBareZMinute = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";

// Pre matches with all three odds inside the rule's horizon, kickoff ASC.
// `matchIds`, when given, scopes candidates to just those matches (e.g. running
// autobets for a single match right after its odds post).
async function candidateMatches(horizonDays: number, matchIds?: number[]): Promise<MatchRow[]> {
  const now = Date.now();
  const until = toBareZMinute(now + horizonDays * 24 * 60 * 60 * 1000);
  const nowIsoStr = toBareZMinute(now);
  const scope = matchIds && matchIds.length > 0;
  const idClause = scope ? ` AND m.id IN (${matchIds!.map(() => "?").join(",")})` : "";
  const rows = (
    await db.execute({
      sql: `${MATCH_SELECT}
            WHERE m.status = 'pre'
              AND m.odds_home IS NOT NULL AND m.odds_draw IS NOT NULL AND m.odds_away IS NOT NULL
              AND m.kickoff_utc >= ? AND m.kickoff_utc <= ?${idClause}
            ORDER BY m.kickoff_utc ASC, m.id ASC`,
      args: scope ? [nowIsoStr, until, ...matchIds!] : [nowIsoStr, until],
    })
  ).rows as any[];
  return rows as MatchRow[];
}

// Match ids the person is already committed to: any placement, OR any spot in
// any pool on that match.
async function committedMatchIds(personId: number): Promise<Set<number>> {
  const placed = (
    await db.execute({ sql: "SELECT match_id FROM auto_bet_placements WHERE person_id = ?", args: [personId] })
  ).rows as any[];
  const held = (
    await db.execute({
      sql: `SELECT match_id FROM bet_pools
            WHERE home_person_id = ? OR draw_person_id = ? OR away_person_id = ?`,
      args: [personId, personId, personId],
    })
  ).rows as any[];
  const ids = new Set<number>();
  for (const r of placed) ids.add(Number(r.match_id));
  for (const r of held) ids.add(Number(r.match_id));
  return ids;
}

// ---- Placement planning -------------------------------------------------------

interface PlanStep {
  action: "open" | "join";
  outcome: Outcome;
  amount: number;
  poolId: number | null; // for join: the pool to join
}

interface MatchPlan {
  match: MatchRow;
  outcome: Outcome;
  steps: PlanStep[]; // 0..n joins, OR exactly one open. Never both. Never empty unless skipped.
}

// Decide what a rule WOULD do on one eligible match — without mutating.
//
// `stake` is a per-match BUDGET, not a fixed bet. JOIN PHASE: greedily join the
// oldest affordable open `target` slots until the remaining budget can't cover
// any more (never splitting a pool — if a slot costs more than what's left, it's
// skipped). OPEN PHASE: only if the join phase found nothing at all, open ONE new
// pool at the full stake. Returns null to skip (target null).
async function planForMatch(rule: AutoBetRule, m: MatchRow): Promise<MatchPlan | null> {
  const outcome = targetOutcome(rule.criteria, rule.personId, m);
  if (!outcome) return null;

  const pools = await getOpenPoolsForMatch(m.id); // ORDER BY created_at (oldest first)
  const steps: PlanStep[] = [];
  let remaining = rule.stake;
  const joinedPoolIds = new Set<number>();

  // Greedy multi-join, capped by budget. Re-scan each pass so we always take the
  // oldest still-affordable open target slot.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = pools.find(
      (p) =>
        !joinedPoolIds.has(p.id) &&
        p.spots[outcome].manager == null &&
        p.spots[outcome].buyin <= remaining,
    );
    if (!next) break;
    steps.push({ action: "join", outcome, amount: next.spots[outcome].buyin, poolId: next.id });
    joinedPoolIds.add(next.id);
    remaining -= next.spots[outcome].buyin;
  }

  // OPEN only if no join happened at all. (committedMatchIds upstream guarantees
  // the person doesn't already hold a spot in any pool on this match, so within a
  // single planning pass the join targets are all pools they're not yet in.)
  if (steps.length === 0) {
    steps.push({ action: "open", outcome, amount: rule.stake, poolId: null });
  }

  return { match: m, outcome, steps };
}

// ---- Run ----------------------------------------------------------------------

export async function runAutoBets(opts?: { personId?: number; matchIds?: number[] }): Promise<{
  placed: number;
  opened: number;
  joined: number;
}> {
  const rules = (
    opts?.personId != null
      ? ((await db.execute({
          sql: "SELECT * FROM auto_bet_rules WHERE active = 1 AND person_id = ? ORDER BY person_id ASC",
          args: [opts.personId],
        })).rows as any[])
      : ((await db.execute("SELECT * FROM auto_bet_rules WHERE active = 1 ORDER BY person_id ASC")).rows as any[])
  ).map(shapeRule);

  let opened = 0;
  let joined = 0;

  for (const rule of rules) {
    const candidates = await candidateMatches(rule.horizonDays, opts?.matchIds);
    if (candidates.length === 0) continue;
    // Recompute per rule so determinism holds across this rule's whole batch.
    const committed = await committedMatchIds(rule.personId);

    for (const m of candidates) {
      if (committed.has(m.id)) continue;
      try {
        const plan = await planForMatch(rule, m);
        if (!plan) continue;

        let placedAny = false;
        for (const step of plan.steps) {
          if (step.action === "join") {
            const res = await takeSpot({ poolId: step.poolId!, personId: rule.personId, outcome: step.outcome });
            if (!res.ok) continue; // a slot got taken first -> skip it, keep going
            await recordPlacement(rule.personId, m.id, step.poolId!, step.outcome, "join");
            joined++;
            placedAny = true;
          } else {
            const res = await createPool({
              matchId: m.id,
              creatorPersonId: rule.personId,
              outcome: step.outcome,
              buyin: step.amount,
            });
            if (!res.ok || res.poolId == null) continue;
            await recordPlacement(rule.personId, m.id, res.poolId, step.outcome, "open");
            opened++;
            placedAny = true;
          }
        }
        // Once we've placed anything on this match, it's handled — future runs
        // skip it (leftover budget is never topped up later).
        if (placedAny) committed.add(m.id);
      } catch {
        // One match blowing up must not abort the batch — retried next run.
        continue;
      }
    }
  }

  return { placed: opened + joined, opened, joined };
}

async function recordPlacement(
  personId: number,
  matchId: number,
  poolId: number,
  outcome: Outcome,
  action: "open" | "join",
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO auto_bet_placements (person_id, match_id, pool_id, outcome, action, placed_at)
          VALUES (?,?,?,?,?,?)`,
    args: [personId, matchId, poolId, outcome, action, nowIso()],
  });
}

// ---- Preview (dry run) --------------------------------------------------------

export interface PreviewItem {
  matchId: number;
  matchLabel: string;
  outcome: Outcome;
  action: "open" | "join";
  amount: number;
}

// What the person's active rule WOULD place right now. No writes. `matchIds`
// optionally scopes the preview to specific matches.
export async function previewAutoBets(personId: number, matchIds?: number[]): Promise<PreviewItem[]> {
  const rule = await getRule(personId);
  if (!rule || !rule.active) return [];

  const candidates = await candidateMatches(rule.horizonDays, matchIds);
  const committed = await committedMatchIds(personId);

  const out: PreviewItem[] = [];
  for (const m of candidates) {
    if (committed.has(m.id)) continue;
    const plan = await planForMatch(rule, m);
    if (!plan) continue;
    const label = `${m.home_name ?? "?"} v ${m.away_name ?? "?"}`;
    for (const step of plan.steps) {
      out.push({
        matchId: m.id,
        matchLabel: label,
        outcome: step.outcome,
        action: step.action,
        amount: step.amount,
      });
    }
  }
  return out;
}

// ---- Activity log -------------------------------------------------------------

export interface PlacementView {
  id: number;
  matchId: number;
  matchLabel: string;
  poolId: number | null;
  outcome: Outcome;
  action: "open" | "join";
  placedAt: string | null;
}

export async function getPlacements(personId: number): Promise<PlacementView[]> {
  const rows = (
    await db.execute({
      sql: `SELECT ap.id, ap.match_id, ap.pool_id, ap.outcome, ap.action, ap.placed_at,
                   m.home_name, m.away_name
            FROM auto_bet_placements ap
            JOIN matches m ON m.id = ap.match_id
            WHERE ap.person_id = ?
            ORDER BY ap.placed_at DESC, ap.id DESC`,
      args: [personId],
    })
  ).rows as any[];
  return rows.map((r) => ({
    id: Number(r.id),
    matchId: Number(r.match_id),
    matchLabel: `${r.home_name ?? "?"} v ${r.away_name ?? "?"}`,
    poolId: r.pool_id == null ? null : Number(r.pool_id),
    outcome: r.outcome as Outcome,
    action: r.action as "open" | "join",
    placedAt: r.placed_at ?? null,
  }));
}

// ---- Revert -------------------------------------------------------------------

// Undo the person's still-cancelable OPENED pools (status 'open', <2 filled
// spots). Joined placements and locked pools are left alone. Reverted placement
// rows are deleted.
export async function revertOpenAutoBets(personId: number): Promise<{ reverted: number }> {
  const placements = (
    await db.execute({
      sql: "SELECT * FROM auto_bet_placements WHERE person_id = ? AND action = 'open'",
      args: [personId],
    })
  ).rows as any[];

  let reverted = 0;
  for (const p of placements) {
    const poolId = p.pool_id == null ? null : Number(p.pool_id);
    if (poolId == null) continue;
    const pool = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id = ?", args: [poolId] })).rows[0] as any;
    if (!pool) {
      // Pool vanished — drop the dangling placement.
      await db.execute({ sql: "DELETE FROM auto_bet_placements WHERE id = ?", args: [Number(p.id)] });
      continue;
    }
    const filled = [pool.home_person_id, pool.draw_person_id, pool.away_person_id].filter((x) => x != null).length;
    if (pool.status !== "open" || filled >= 2) continue; // locked/joined -> leave it

    const res = await cancelPool({ poolId, personId });
    if (!res.ok) continue;
    await db.execute({ sql: "DELETE FROM auto_bet_placements WHERE id = ?", args: [Number(p.id)] });
    reverted++;
  }
  return { reverted };
}
