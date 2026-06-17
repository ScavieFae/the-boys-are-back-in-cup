/* eslint-disable @typescript-eslint/no-explicit-any */
// Three-spot betting pool engine: creation, taking spots, cancel, settlement,
// and the net ledger. The money math lives in lib/betting.ts; this file is the
// database lifecycle around it.
import { db, ensureSchema } from "./db";
import { deVig, computeBuyins, settlePool, OUTCOMES, type Outcome } from "./betting";
import { emitFeedEvent, settlePayload } from "./feed";
import { effectiveStatus, effectiveResult } from "./matchstatus";
import { pariLedgerTransfers } from "./parimutuel";
import { settlementLedgerTransfers } from "./settlements";

const nowIso = () => new Date().toISOString();
const PERSON_COL: Record<Outcome, string> = {
  home: "home_person_id",
  draw: "draw_person_id",
  away: "away_person_id",
};

export type EngineResult =
  | { ok: true; poolId?: number }
  | { ok: false; error: string };

// ---- Creation & participation -------------------------------------------------

export async function createPool(opts: {
  matchId: number;
  creatorPersonId: number;
  outcome: Outcome;
  buyin: number;
  source?: "manual" | "auto";
  runId?: string | null;
}): Promise<EngineResult> {
  const { matchId, creatorPersonId, outcome, buyin, source = "manual", runId = null } = opts;
  if (!OUTCOMES.includes(outcome)) return { ok: false, error: "invalid outcome" };
  if (!Number.isInteger(buyin) || buyin < 1) {
    return { ok: false, error: "buy-in must be a whole dollar amount of at least $1" };
  }

  const m = (
    await db.execute({
      sql: "SELECT id, status, manual_override, manual_status, odds_home, odds_draw, odds_away FROM matches WHERE id = ?",
      args: [matchId],
    })
  ).rows[0] as any;
  if (!m) return { ok: false, error: "match not found" };
  if (effectiveStatus(m) === "post") return { ok: false, error: "match has finished — betting closed" };

  const probs = deVig({ home: m.odds_home, draw: m.odds_draw, away: m.odds_away });
  if (!probs) return { ok: false, error: "no betting line available for this match yet" };

  const raw = computeBuyins(probs, outcome, buyin);
  const buyins: Record<Outcome, number> = {
    home: Math.max(1, raw.home),
    draw: Math.max(1, raw.draw),
    away: Math.max(1, raw.away),
  };
  buyins[outcome] = buyin; // creator's stays exact

  const ts = nowIso();
  const res = await db.execute({
    sql: `INSERT INTO bet_pools
      (match_id, created_by, created_at, odds_home, odds_draw, odds_away,
       buyin_home, buyin_draw, buyin_away, ${PERSON_COL[outcome]}, status, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'open', ?)`,
    args: [
      matchId, creatorPersonId, ts, m.odds_home, m.odds_draw, m.odds_away,
      buyins.home, buyins.draw, buyins.away, creatorPersonId, ts,
    ],
  });
  const poolId = Number(res.lastInsertRowid);
  await emitFeedEvent({
    type: "bet_opened",
    actorId: creatorPersonId,
    matchId,
    poolId,
    source,
    runId,
    payload: { outcome, amount: buyin },
    dedupKey: "open:" + poolId,
  });
  return { ok: true, poolId };
}

export async function takeSpot(opts: {
  poolId: number;
  personId: number;
  outcome: Outcome;
  source?: "manual" | "auto";
  runId?: string | null;
}): Promise<EngineResult> {
  const { poolId, personId, outcome, source = "manual", runId = null } = opts;
  if (!OUTCOMES.includes(outcome)) return { ok: false, error: "invalid outcome" };

  const p = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id = ?", args: [poolId] })).rows[0] as any;
  if (!p) return { ok: false, error: "bet not found" };
  if (p.status !== "open") return { ok: false, error: "this bet is closed" };

  const m = (await db.execute({ sql: "SELECT status, manual_override, manual_status FROM matches WHERE id = ?", args: [p.match_id] })).rows[0] as any;
  if (!m || effectiveStatus(m) === "post") return { ok: false, error: "match has finished — betting closed" };

  const holders = [p.home_person_id, p.draw_person_id, p.away_person_id]
    .filter((x) => x != null)
    .map((x) => Number(x));
  if (holders.includes(personId)) return { ok: false, error: "you already hold a spot in this bet" };
  if (p[PERSON_COL[outcome]] != null) return { ok: false, error: "that spot is already taken" };

  // Guard against two people grabbing the same spot at once.
  const upd = await db.execute({
    sql: `UPDATE bet_pools SET ${PERSON_COL[outcome]} = ?, updated_at = ?
          WHERE id = ? AND ${PERSON_COL[outcome]} IS NULL`,
    args: [personId, nowIso(), poolId],
  });
  if (upd.rowsAffected === 0) return { ok: false, error: "that spot was just taken" };

  await emitFeedEvent({
    type: "bet_joined",
    actorId: personId,
    matchId: Number(p.match_id),
    poolId,
    source,
    runId,
    payload: { outcome, amount: Number(p[`buyin_${outcome}`]) },
    dedupKey: "take:" + poolId + ":" + outcome,
  });

  // Did this take just fill the pool? Re-read the person columns AFTER the
  // update — if all three are now claimed, emit bet_filled (system, idempotent).
  const after = (
    await db.execute({
      sql: "SELECT home_person_id, draw_person_id, away_person_id FROM bet_pools WHERE id = ?",
      args: [poolId],
    })
  ).rows[0] as any;
  if (after && OUTCOMES.every((o) => after[PERSON_COL[o]] != null)) {
    await emitFeedEvent({
      type: "bet_filled",
      actorId: null,
      matchId: Number(p.match_id),
      poolId,
      source: "system",
      payload: {},
      dedupKey: "filled:" + poolId,
    });
  }
  return { ok: true };
}

export async function cancelPool(opts: { poolId: number; personId: number }): Promise<EngineResult> {
  const { poolId, personId } = opts;
  const p = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id = ?", args: [poolId] })).rows[0] as any;
  if (!p) return { ok: false, error: "bet not found" };
  if (p.status !== "open") return { ok: false, error: "this bet is closed" };
  if (Number(p.created_by) !== personId) return { ok: false, error: "only the creator can cancel" };
  const filled = [p.home_person_id, p.draw_person_id, p.away_person_id].filter((x) => x != null).length;
  if (filled >= 2) return { ok: false, error: "can't cancel — someone has already joined" };
  await db.execute({ sql: "UPDATE bet_pools SET status='void', updated_at=? WHERE id=?", args: [nowIso(), poolId] });
  await emitFeedEvent({
    type: "bet_canceled",
    actorId: personId,
    matchId: Number(p.match_id),
    poolId,
    payload: {},
    dedupKey: "cancel:" + poolId,
  });
  return { ok: true };
}

// Re-price an open, unclaimed (creator-only) pool against the CURRENT match line,
// changing only the dollar budget. The creator's pick is fixed; their spot stays
// the exact new buy-in and the two other spots are re-derived. Only available
// while the creator is the sole holder — the moment anyone joins, edit is gone.
export async function editPool(opts: { poolId: number; personId: number; buyin: number }): Promise<EngineResult> {
  await ensureSchema();
  const { poolId, personId, buyin } = opts;
  if (!Number.isInteger(buyin) || buyin < 1) {
    return { ok: false, error: "buy-in must be a whole dollar amount of at least $1" };
  }

  const p = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id = ?", args: [poolId] })).rows[0] as any;
  if (!p) return { ok: false, error: "bet not found" };
  if (p.status !== "open") return { ok: false, error: "this bet is closed" };
  if (Number(p.created_by) !== personId) return { ok: false, error: "only the creator can edit" };

  const filled = [p.home_person_id, p.draw_person_id, p.away_person_id].filter((x) => x != null).length;
  if (filled >= 2) return { ok: false, error: "can't edit — someone has already joined" };

  // The creator's outcome is the spot they hold.
  const creatorOutcome = OUTCOMES.find((o) => Number(p[PERSON_COL[o]]) === personId);
  if (!creatorOutcome) return { ok: false, error: "you don't hold a spot in this bet" };

  const m = (
    await db.execute({
      sql: "SELECT id, status, manual_override, manual_status, odds_home, odds_draw, odds_away FROM matches WHERE id = ?",
      args: [p.match_id],
    })
  ).rows[0] as any;
  if (!m) return { ok: false, error: "match not found" };
  if (effectiveStatus(m) === "post") return { ok: false, error: "match has finished — betting closed" };

  const probs = deVig({ home: m.odds_home, draw: m.odds_draw, away: m.odds_away });
  if (!probs) return { ok: false, error: "no current line available to re-price this bet" };

  const raw = computeBuyins(probs, creatorOutcome, buyin);
  const buyins: Record<Outcome, number> = {
    home: Math.max(1, raw.home),
    draw: Math.max(1, raw.draw),
    away: Math.max(1, raw.away),
  };
  buyins[creatorOutcome] = buyin; // creator's stays exact

  // Concurrency guard: only re-price while the two NON-creator spots are still
  // open, so an edit can't race a join. Build the IS NULL clause dynamically.
  const otherCols = OUTCOMES.filter((o) => o !== creatorOutcome).map((o) => PERSON_COL[o]);
  const nullGuard = otherCols.map((c) => `${c} IS NULL`).join(" AND ");
  const ts = nowIso();
  const upd = await db.execute({
    sql: `UPDATE bet_pools
          SET odds_home = ?, odds_draw = ?, odds_away = ?,
              buyin_home = ?, buyin_draw = ?, buyin_away = ?,
              edited_at = ?, updated_at = ?
          WHERE id = ? AND status = 'open' AND created_by = ? AND ${nullGuard}`,
    args: [
      m.odds_home, m.odds_draw, m.odds_away,
      buyins.home, buyins.draw, buyins.away,
      ts, ts, poolId, personId,
    ],
  });
  if (upd.rowsAffected === 0) return { ok: false, error: "this bet was just joined — edit is no longer available" };
  await emitFeedEvent({
    type: "bet_edited",
    actorId: personId,
    matchId: Number(p.match_id),
    poolId,
    payload: { outcome: creatorOutcome, oldAmount: Number(p[`buyin_${creatorOutcome}`]), newAmount: buyin },
    dedupKey: null, // edits can repeat
  });
  return { ok: true };
}

// ---- Settlement ---------------------------------------------------------------

// Resolve every open pool whose match is final ('post'): void if <2 spots, else
// settle to its result. Pools on 'pre' or live ('in') matches are left open and
// joinable — betting runs until full-time. Safe to call repeatedly (idempotent).
export async function settleAllPools(): Promise<{ settled: number; voided: number }> {
  const pools = (await db.execute("SELECT * FROM bet_pools WHERE status = 'open'")).rows as any[];
  if (pools.length === 0) return { settled: 0, voided: 0 };

  const matchIds = [...new Set(pools.map((p) => p.match_id))];
  const placeholders = matchIds.map(() => "?").join(",");
  const matches = (await db.execute({ sql: `SELECT * FROM matches WHERE id IN (${placeholders})`, args: matchIds })).rows as any[];
  const byId = new Map(matches.map((m) => [Number(m.id), m]));

  // Manager names for the settle payload (person id -> name), so the feed can
  // compose "Winner (PICK,+$X) beat Loser (PICK,-$Y)" without a re-join.
  const personIds = [
    ...new Set(
      pools.flatMap((p) => [p.home_person_id, p.draw_person_id, p.away_person_id]).filter((x) => x != null).map((x) => Number(x)),
    ),
  ];
  const nameById = new Map<number, string>();
  if (personIds.length) {
    const ph = personIds.map(() => "?").join(",");
    const people = (await db.execute({ sql: `SELECT id, name FROM people WHERE id IN (${ph})`, args: personIds })).rows as any[];
    for (const r of people) nameById.set(Number(r.id), r.name as string);
  }
  const mgrFor = (p: any): Record<Outcome, string | null> => ({
    home: p.home_person_id != null ? nameById.get(Number(p.home_person_id)) ?? null : null,
    draw: p.draw_person_id != null ? nameById.get(Number(p.draw_person_id)) ?? null : null,
    away: p.away_person_id != null ? nameById.get(Number(p.away_person_id)) ?? null : null,
  });

  let settled = 0;
  let voided = 0;
  for (const p of pools) {
    const m = byId.get(Number(p.match_id));
    if (!m) continue;
    const st = effectiveStatus(m);
    if (st !== "post") continue; // pre OR live ('in'): leave the pool open/joinable, untouched

    const filled = OUTCOMES.filter((o) => p[PERSON_COL[o]] != null);
    if (filled.length < 2) {
      await db.execute({ sql: "UPDATE bet_pools SET status='void', updated_at=? WHERE id=?", args: [nowIso(), p.id] });
      await emitFeedEvent({
        type: "bet_voided",
        actorId: null,
        matchId: Number(p.match_id),
        poolId: Number(p.id),
        source: "system",
        payload: {},
        dedupKey: "void:" + Number(p.id),
      });
      voided++;
      continue;
    }

    const result = effectiveResult(m);
    if (!result) continue;
    const ts = nowIso();
    await db.execute({
      sql: "UPDATE bet_pools SET status='settled', result=?, settled_at=?, updated_at=? WHERE id=?",
      args: [result, ts, ts, p.id],
    });
    await emitFeedEvent({
      type: "bet_settled",
      actorId: null,
      matchId: Number(p.match_id),
      poolId: Number(p.id),
      source: "system",
      payload: settlePayload(p, result, mgrFor(p)),
      dedupKey: "settle:" + Number(p.id),
    });
    settled++;
  }
  return { settled, voided };
}

// ---- Ledger -------------------------------------------------------------------

export interface LedgerDebt { from: string; to: string; amount: number } // `from` owes `to`
export interface BettorTotal { manager: string; net: number; settledBets: number }
export interface LedgerSummary { debts: LedgerDebt[]; totals: BettorTotal[]; pushes: number }

export async function getLedger(): Promise<LedgerSummary> {
  const rows = (
    await db.execute(`
      SELECT bp.buyin_home, bp.buyin_draw, bp.buyin_away, bp.result,
             hp.name AS home_mgr, dp.name AS draw_mgr, ap.name AS away_mgr
      FROM bet_pools bp
      LEFT JOIN people hp ON hp.id = bp.home_person_id
      LEFT JOIN people dp ON dp.id = bp.draw_person_id
      LEFT JOIN people ap ON ap.id = bp.away_person_id
      WHERE bp.status = 'settled' AND bp.result IS NOT NULL
    `)
  ).rows as any[];

  const directed = new Map<string, number>(); // `${from}>${to}` -> amount
  const net = new Map<string, number>(); // manager -> net winnings
  const involved = new Map<string, Set<number>>(); // manager -> set (count settled bets they were in)
  let pushes = 0;

  rows.forEach((r, idx) => {
    const mgr: Record<Outcome, string | null> = { home: r.home_mgr, draw: r.draw_mgr, away: r.away_mgr };
    const filled: Partial<Record<Outcome, number>> = {};
    for (const o of OUTCOMES) if (mgr[o]) filled[o] = Number((r as any)[`buyin_${o}`]);

    const s = settlePool(filled, r.result as Outcome);
    for (const o of OUTCOMES) {
      if (mgr[o]) {
        if (!involved.has(mgr[o]!)) involved.set(mgr[o]!, new Set());
        involved.get(mgr[o]!)!.add(idx);
      }
    }
    if (s.status === "push") { pushes++; return; }
    if (s.status !== "win") return;
    for (const e of s.entries) {
      const from = mgr[e.from]!;
      const to = mgr[e.to]!;
      directed.set(`${from}>${to}`, (directed.get(`${from}>${to}`) ?? 0) + e.amount);
      net.set(to, (net.get(to) ?? 0) + e.amount);
      net.set(from, (net.get(from) ?? 0) - e.amount);
    }
  });

  // Fold settled pari-mutuel pots into the SAME directed/net maps, exactly as the
  // 3-spot entries above. With ZERO pari pools this loop is a no-op, so the
  // ledger is byte-identical to before. (Pari involvement is NOT counted toward
  // `settledBets`, which stays a 3-spot count.) Pari splits are fractional, so we
  // round the final debts and net totals to whole dollars below.
  const pariTransfers = await pariLedgerTransfers();
  for (const t of pariTransfers) {
    directed.set(`${t.from}>${t.to}`, (directed.get(`${t.from}>${t.to}`) ?? 0) + t.amount);
    net.set(t.to, (net.get(t.to) ?? 0) + t.amount);
    net.set(t.from, (net.get(t.from) ?? 0) - t.amount);
    // Surface pari-only participants in `totals` too. Their `settledBets` (a
    // 3-spot count) stays 0 — register an empty involvement set if unseen.
    if (!involved.has(t.from)) involved.set(t.from, new Set());
    if (!involved.has(t.to)) involved.set(t.to, new Set());
  }

  // Fold settle-up payments into the SAME directed/net maps. Each active
  // settlement emits a REVERSE edge (creditor "owes back" the paid amount), so
  // netting subtracts it from the original bet-debt — leaving OUTSTANDING debts.
  // With ZERO active settlements this returns [] and the loop is a no-op, so the
  // ledger is byte-identical to before. An over-payment can flip a pair (the
  // creditor ends up owed-back); netting handles that correctly — no special-case.
  const settleTransfers = await settlementLedgerTransfers();
  for (const t of settleTransfers) {
    directed.set(`${t.from}>${t.to}`, (directed.get(`${t.from}>${t.to}`) ?? 0) + t.amount);
    net.set(t.to, (net.get(t.to) ?? 0) + t.amount);
    net.set(t.from, (net.get(t.from) ?? 0) - t.amount);
    if (!involved.has(t.from)) involved.set(t.from, new Set());
    if (!involved.has(t.to)) involved.set(t.to, new Set());
  }

  // Net opposing directions into one debt per pair.
  const seen = new Set<string>();
  const debts: LedgerDebt[] = [];
  for (const key of directed.keys()) {
    const [a, b] = key.split(">");
    const pair = [a, b].sort().join("|");
    if (seen.has(pair)) continue;
    seen.add(pair);
    const ab = directed.get(`${a}>${b}`) ?? 0;
    const ba = directed.get(`${b}>${a}`) ?? 0;
    const diff = Math.round(ab - ba); // round fractional pari splits to whole dollars
    if (diff > 0) debts.push({ from: a, to: b, amount: diff });
    else if (diff < 0) debts.push({ from: b, to: a, amount: -diff });
  }
  debts.sort((x, y) => y.amount - x.amount);

  const totals: BettorTotal[] = [...involved.keys()]
    .map((manager) => ({ manager, net: Math.round(net.get(manager) ?? 0), settledBets: involved.get(manager)!.size }))
    .sort((x, y) => y.net - x.net || x.manager.localeCompare(y.manager));

  return { debts, totals, pushes };
}

// ---- Read views (for UI) ------------------------------------------------------

export interface SpotView {
  outcome: Outcome;
  manager: string | null; // null = open spot
  buyin: number;
}

export interface PoolView {
  id: number;
  matchId: number;
  status: string; // open | settled | void
  result: Outcome | null;
  createdBy: string;
  // match context
  match: {
    homeName: string;
    awayName: string;
    homeCode: string | null;
    awayCode: string | null;
    kickoffUtc: string;
    status: string; // pre | in | post (raw)
    groupLetter: string | null;
    odds: { home: string | null; draw: string | null; away: string | null } | null;
  };
  spots: Record<Outcome, SpotView>;
  filledCount: number;
  currentPot: number; // sum of filled buy-ins
  fullPot: number; // sum of all three buy-ins (if every spot fills)
  editedAt: string | null; // last time the creator re-priced this open bet
}

const POOL_SELECT = /* sql */ `
  SELECT bp.id, bp.match_id, bp.status, bp.result, bp.created_at, bp.edited_at,
         bp.buyin_home, bp.buyin_draw, bp.buyin_away,
         hp.name AS home_mgr, dp.name AS draw_mgr, ap.name AS away_mgr, cp.name AS creator,
         m.home_name, m.away_name, m.home_code, m.away_code,
         m.kickoff_utc, m.status AS match_status, m.group_letter,
         m.odds_home, m.odds_draw, m.odds_away
  FROM bet_pools bp
  JOIN matches m ON m.id = bp.match_id
  LEFT JOIN people hp ON hp.id = bp.home_person_id
  LEFT JOIN people dp ON dp.id = bp.draw_person_id
  LEFT JOIN people ap ON ap.id = bp.away_person_id
  LEFT JOIN people cp ON cp.id = bp.created_by
`;

function shapePool(r: any): PoolView {
  const spots: Record<Outcome, SpotView> = {
    home: { outcome: "home", manager: r.home_mgr ?? null, buyin: Number(r.buyin_home) },
    draw: { outcome: "draw", manager: r.draw_mgr ?? null, buyin: Number(r.buyin_draw) },
    away: { outcome: "away", manager: r.away_mgr ?? null, buyin: Number(r.buyin_away) },
  };
  const filled = OUTCOMES.filter((o) => spots[o].manager);
  return {
    id: Number(r.id),
    matchId: Number(r.match_id),
    status: r.status,
    result: (r.result ?? null) as Outcome | null,
    createdBy: r.creator,
    match: {
      homeName: r.home_name,
      awayName: r.away_name,
      homeCode: r.home_code,
      awayCode: r.away_code,
      kickoffUtc: r.kickoff_utc,
      status: r.match_status,
      groupLetter: r.group_letter,
      odds:
        r.odds_home != null || r.odds_draw != null || r.odds_away != null
          ? {
              home: r.odds_home != null ? String(r.odds_home) : null,
              draw: r.odds_draw != null ? String(r.odds_draw) : null,
              away: r.odds_away != null ? String(r.odds_away) : null,
            }
          : null,
    },
    spots,
    filledCount: filled.length,
    currentPot: filled.reduce((s, o) => s + spots[o].buyin, 0),
    fullPot: spots.home.buyin + spots.draw.buyin + spots.away.buyin,
    editedAt: r.edited_at ?? null,
  };
}

// Open pools on a single match (for the betting controls on a match card).
export async function getOpenPoolsForMatch(matchId: number): Promise<PoolView[]> {
  await ensureSchema();
  const rows = (
    await db.execute({ sql: `${POOL_SELECT} WHERE bp.match_id = ? AND bp.status = 'open' ORDER BY bp.created_at`, args: [matchId] })
  ).rows as any[];
  return rows.map(shapePool);
}

// Counts of open pools per match id (for the "spots open" flag on cards).
export async function getOpenPoolCounts(): Promise<Map<number, number>> {
  const rows = (await db.execute("SELECT match_id, COUNT(*) n FROM bet_pools WHERE status='open' GROUP BY match_id")).rows as any[];
  return new Map(rows.map((r) => [Number(r.match_id), Number(r.n)]));
}

// Everything for the betting tab: open pools, settled history.
export async function getAllPoolViews(): Promise<{ open: PoolView[]; settled: PoolView[] }> {
  await ensureSchema();
  const rows = (await db.execute(`${POOL_SELECT} WHERE bp.status IN ('open','settled') ORDER BY m.kickoff_utc DESC, bp.created_at DESC`)).rows as any[];
  const all = rows.map(shapePool);
  return {
    open: all.filter((p) => p.status === "open"),
    settled: all.filter((p) => p.status === "settled"),
  };
}

export interface BetStats {
  totalBets: number; // settled pools
  openBets: number;
  totalWagered: number; // dollars across settled pots
  pushes: number;
  biggestPot: number;
  mostBetMatches: { label: string; count: number }[];
}

export async function getBetStats(): Promise<BetStats> {
  const { open, settled } = await getAllPoolViews();
  const totalWagered = settled.reduce((s, p) => s + p.currentPot, 0);
  const biggestPot = settled.reduce((m, p) => Math.max(m, p.currentPot), 0);
  const pushes = settled.filter((p) => p.result && !p.spots[p.result].manager).length;

  const byMatch = new Map<string, number>();
  for (const p of [...open, ...settled]) {
    const label = `${p.match.homeName} v ${p.match.awayName}`;
    byMatch.set(label, (byMatch.get(label) ?? 0) + 1);
  }
  const mostBetMatches = [...byMatch.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { totalBets: settled.length, openBets: open.length, totalWagered, pushes, biggestPot, mostBetMatches };
}

// ---- Per-match action (for the card "Action" column) --------------------------

export interface OutcomeAction {
  staked: number; // total $ bet on this outcome across all pools on the match
  bettors: string[]; // managers who took this outcome (distinct; NOT team owners)
}

export interface MatchAction {
  home: OutcomeAction;
  draw: OutcomeAction;
  away: OutcomeAction;
  totalStaked: number;
  settled: boolean;
  result: Outcome | null; // the outcome that hit, once settled
}

// Aggregate the action on every match that has bets, keyed by match id. Sums
// across multiple pools (trios) on the same game.
export async function getMatchActions(): Promise<Map<number, MatchAction>> {
  const { open, settled } = await getAllPoolViews();
  const map = new Map<number, MatchAction>();
  const blank = (): MatchAction => ({
    home: { staked: 0, bettors: [] },
    draw: { staked: 0, bettors: [] },
    away: { staked: 0, bettors: [] },
    totalStaked: 0,
    settled: false,
    result: null,
  });

  for (const p of [...open, ...settled]) {
    let a = map.get(p.matchId);
    if (!a) { a = blank(); map.set(p.matchId, a); }
    for (const o of OUTCOMES) {
      const s = p.spots[o];
      if (s.manager) {
        a[o].staked += s.buyin;
        if (!a[o].bettors.includes(s.manager)) a[o].bettors.push(s.manager);
        a.totalStaked += s.buyin;
      }
    }
    if (p.status === "settled" && p.result) { a.settled = true; a.result = p.result; }
  }
  return map;
}
