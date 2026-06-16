/* eslint-disable @typescript-eslint/no-explicit-any */
// The AUTO-BET ENGINE.
//
// Each person can set ANY NUMBER of standing rules ("always back the draw",
// "back my own teams", "back the favorite", ...), each with an optional EXCLUDE
// filter (skip my own teams' games / lopsided games / free-agent games).
// runAutoBets() walks every active rule and, for each eligible upcoming match,
// either JOINS an existing pool whose target spot is open and affordable, or
// OPENS a fresh pool. Everything is idempotent: a person is committed to a match
// at most once (one placement row, and we never double up on a match they
// already hold a spot in) — so even with several rules, the FIRST applicable one
// (by deterministic order) wins that match and later rules skip it.
//
// The placement order is deterministic — rules by person_id ASC then a person's
// own sort_order ASC (id ASC tiebreak), matches by kickoff ASC — so that when
// two people's targets collide on the same match, the lower person_id reliably
// OPENS the pool and the higher one JOINS it, and a person's own rules apply in
// their chosen priority order (the top rule wins a contested match).
import { db } from "./db";
import { deVig, type Outcome } from "./betting";
import { createPool, takeSpot, cancelPool, getOpenPoolsForMatch } from "./bets";

const nowIso = () => new Date().toISOString();

// One TEAM side priced at >= this de-vigged probability is a "lopsided" game.
export const LOPSIDED_THRESHOLD = 0.7;

export type AutoBetCriteria =
  | "draw"
  | "my_teams"
  | "home"
  | "away"
  | "favorite"
  | "underdog";

export type AutoBetExclude = "none" | "my_team_games" | "lopsided" | "free_agent";

export interface AutoBetRule {
  id: number;
  personId: number;
  criteria: AutoBetCriteria;
  exclude: AutoBetExclude;
  sortOrder: number;
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
    exclude: (r.exclude ?? "none") as AutoBetExclude,
    sortOrder: Number(r.sort_order ?? 0),
    stake: Number(r.stake),
    horizonDays: Number(r.horizon_days),
    active: Number(r.active) === 1,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

export async function getRules(personId: number): Promise<AutoBetRule[]> {
  const rows = (
    await db.execute({
      sql: "SELECT * FROM auto_bet_rules WHERE person_id = ? ORDER BY sort_order ASC, id ASC",
      args: [personId],
    })
  ).rows as any[];
  return rows.map(shapeRule);
}

export async function getRuleById(ruleId: number): Promise<AutoBetRule | null> {
  const r = (
    await db.execute({ sql: "SELECT * FROM auto_bet_rules WHERE id = ?", args: [ruleId] })
  ).rows[0] as any;
  return r ? shapeRule(r) : null;
}

export async function createRule(input: {
  personId: number;
  criteria: AutoBetCriteria;
  exclude: AutoBetExclude;
  stake: number;
  horizonDays: number;
  active: boolean;
}): Promise<number> {
  const ts = nowIso();
  // New rules go to the bottom of this person's priority list.
  const maxRow = (
    await db.execute({
      sql: "SELECT MAX(sort_order) AS m FROM auto_bet_rules WHERE person_id = ?",
      args: [input.personId],
    })
  ).rows[0] as any;
  const sortOrder = (maxRow?.m == null ? 0 : Number(maxRow.m)) + 1;
  const res = await db.execute({
    sql: `INSERT INTO auto_bet_rules
            (person_id, criteria, exclude, sort_order, stake, horizon_days, active, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      input.personId,
      input.criteria,
      input.exclude,
      sortOrder,
      input.stake,
      input.horizonDays,
      input.active ? 1 : 0,
      ts,
      ts,
    ],
  });
  return Number(res.lastInsertRowid);
}

// Update a rule's settings, preserving its active flag.
export async function updateRule(
  ruleId: number,
  settings: {
    criteria: AutoBetCriteria;
    exclude: AutoBetExclude;
    stake: number;
    horizonDays: number;
  },
): Promise<void> {
  await db.execute({
    sql: `UPDATE auto_bet_rules
          SET criteria = ?, exclude = ?, stake = ?, horizon_days = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      settings.criteria,
      settings.exclude,
      settings.stake,
      settings.horizonDays,
      nowIso(),
      ruleId,
    ],
  });
}

export async function setRuleActive(ruleId: number, active: boolean): Promise<void> {
  await db.execute({
    sql: "UPDATE auto_bet_rules SET active = ?, updated_at = ? WHERE id = ?",
    args: [active ? 1 : 0, nowIso(), ruleId],
  });
}

export async function deleteRule(ruleId: number): Promise<void> {
  await db.execute({ sql: "DELETE FROM auto_bet_rules WHERE id = ?", args: [ruleId] });
}

// Swap a rule's priority with its adjacent sibling (same person). No-op at the
// ends. 'up' = higher priority (lower in the ordered list). Returns false if it
// didn't move (rule missing, or already at the boundary).
export async function moveRule(ruleId: number, direction: "up" | "down"): Promise<boolean> {
  const rule = await getRuleById(ruleId);
  if (!rule) return false;
  const siblings = await getRules(rule.personId); // sort_order ASC, id ASC
  const idx = siblings.findIndex((r) => r.id === ruleId);
  if (idx < 0) return false;
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= siblings.length) return false; // at the end
  const a = siblings[idx];
  const b = siblings[targetIdx];
  const ts = nowIso();
  // Swap their sort_order values. Tiebreak (equal sort_order) is by id, so write
  // distinct values to guarantee the visible order actually flips.
  const loOrder = Math.min(a.sortOrder, b.sortOrder);
  const hiOrder = Math.max(a.sortOrder, b.sortOrder);
  const earlier = direction === "up" ? a : b; // the one that should end up first
  const later = direction === "up" ? b : a;
  await db.execute({
    sql: "UPDATE auto_bet_rules SET sort_order = ?, updated_at = ? WHERE id = ?",
    args: [loOrder, ts, earlier.id],
  });
  await db.execute({
    sql: "UPDATE auto_bet_rules SET sort_order = ?, updated_at = ? WHERE id = ?",
    args: [hiOrder === loOrder ? loOrder + 1 : hiOrder, ts, later.id],
  });
  return true;
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

// ---- Exclude filter -----------------------------------------------------------

// True when a rule's EXCLUDE filter says to skip this match (place nothing).
// Applied AFTER the target outcome is computed, BEFORE any placement, and in
// preview too — so excluded matches produce no preview lines and no bets.
function isExcluded(exclude: AutoBetExclude, personId: number, m: MatchRow): boolean {
  switch (exclude) {
    case "none":
      return false;
    case "my_team_games": {
      // Skip if the rule's person OWNS either team in the match.
      const ownsHome = m.home_owner != null && Number(m.home_owner) === personId;
      const ownsAway = m.away_owner != null && Number(m.away_owner) === personId;
      return ownsHome || ownsAway;
    }
    case "lopsided": {
      // Skip if one TEAM is a heavy favorite (draw is never a "favorite").
      const probs = deVig({ home: m.odds_home, draw: m.odds_draw, away: m.odds_away });
      if (!probs) return false; // can't tell -> don't exclude (eligibility drops no-odds anyway)
      return Math.max(probs.home, probs.away) >= LOPSIDED_THRESHOLD;
    }
    case "free_agent": {
      // Skip if NEITHER team is owned by anyone (both owner_id null / unmatched).
      const homeOwned = m.home_owner != null;
      const awayOwned = m.away_owner != null;
      return !homeOwned && !awayOwned;
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
  // EXCLUDE filter: computed after the target outcome, before any placement.
  if (isExcluded(rule.exclude, rule.personId, m)) return null;

  const pools = await getOpenPoolsForMatch(m.id); // ORDER BY created_at (oldest first)
  const steps: PlanStep[] = [];
  let remaining = rule.stake;
  const joinedPoolIds = new Set<number>();

  // Greedy multi-join, capped by budget. Re-scan each pass so we always take the
  // oldest still-affordable open target slot.
  for (;;) {
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
  // Deterministic order: person_id ASC, then the person's own priority
  // (sort_order ASC, id ASC). committedMatchIds is per-PERSON, so a person bets
  // at most ONCE per match even with several rules — the first applicable rule
  // in this order wins the match, later rules skip it.
  const rules = (
    opts?.personId != null
      ? ((await db.execute({
          sql: "SELECT * FROM auto_bet_rules WHERE active = 1 AND person_id = ? ORDER BY person_id ASC, sort_order ASC, id ASC",
          args: [opts.personId],
        })).rows as any[])
      : ((await db.execute("SELECT * FROM auto_bet_rules WHERE active = 1 ORDER BY person_id ASC, sort_order ASC, id ASC")).rows as any[])
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

// What a SPECIFIC set of rule settings WOULD place right now — a hypothetical
// dry run, shown regardless of whether the settings are saved/active (so a card
// can preview unsaved form values and the activate confirmation). No writes.
// `matchIds` optionally scopes the preview. Preview is always for explicit
// settings now (one card at a time), including the EXCLUDE filter.
export async function previewAutoBets(
  personId: number,
  matchIds: number[] | undefined,
  settings: {
    criteria: AutoBetCriteria;
    exclude: AutoBetExclude;
    stake: number;
    horizonDays: number;
  },
): Promise<PreviewItem[]> {
  const rule: AutoBetRule = {
    id: 0,
    personId,
    criteria: settings.criteria,
    exclude: settings.exclude,
    sortOrder: 0,
    stake: settings.stake,
    horizonDays: settings.horizonDays,
    active: false,
    createdAt: null,
    updatedAt: null,
  };

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
