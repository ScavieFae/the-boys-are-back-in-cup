/* eslint-disable @typescript-eslint/no-explicit-any */
// Pari-mutuel pot engine: contribution, settlement, ledger transfers, and the
// read views. ONE pool per match. Betting CLOSES at kickoff — contributions are
// only accepted while the match is 'pre'. At full-time the whole pot is split
// pro-rata among the backers of the winning outcome; if nobody backed the
// winner, the pool voids (everyone refunded).
//
// This file NEVER imports lib/bets.ts — bets.ts imports pariLedgerTransfers()
// from here to fold pari results into the unified Settle Up. Shared status
// helpers live in lib/matchstatus.ts so the dependency stays one-directional.
import { db, ensureSchema } from "./db";
import { OUTCOMES, type Outcome } from "./betting";
import { effectiveStatus, effectiveResult } from "./matchstatus";
import { emitFeedEvent } from "./feed";

const nowIso = () => new Date().toISOString();

// ---- Contribution -------------------------------------------------------------

export async function contribute(opts: {
  matchId: number;
  personId: number;
  outcome: Outcome;
  amount: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSchema();
  const { matchId, personId, outcome, amount } = opts;

  if (!Number.isInteger(amount) || amount < 1) {
    return { ok: false, error: "amount must be a whole dollar amount of at least $1" };
  }
  if (!OUTCOMES.includes(outcome)) return { ok: false, error: "invalid outcome" };

  const m = (
    await db.execute({
      sql: "SELECT id, status, manual_override, manual_status FROM matches WHERE id = ?",
      args: [matchId],
    })
  ).rows[0] as any;
  if (!m) return { ok: false, error: "match not found" };
  // Betting closes at kickoff: contributions only while the match is 'pre'.
  if (effectiveStatus(m) !== "pre") return { ok: false, error: "the pot closed at kickoff" };

  // Get-or-create the match's pool. UNIQUE(match_id) guards against a race —
  // if two contributions create at once, one INSERT OR IGNORE wins and we re-read.
  let pool = (await db.execute({ sql: "SELECT * FROM pari_pools WHERE match_id = ?", args: [matchId] })).rows[0] as any;
  if (!pool) {
    const ts = nowIso();
    await db.execute({
      sql: "INSERT OR IGNORE INTO pari_pools (match_id, status, created_at, updated_at) VALUES (?, 'open', ?, ?)",
      args: [matchId, ts, ts],
    });
    pool = (await db.execute({ sql: "SELECT * FROM pari_pools WHERE match_id = ?", args: [matchId] })).rows[0] as any;
  }
  if (!pool) return { ok: false, error: "could not open the pot" };
  if (pool.status !== "open") return { ok: false, error: "the pot is closed" };

  const poolId = Number(pool.id);

  // One-outcome rule: a person can top up the SAME outcome, but not split across
  // two. Reject if they already hold any entry on a different outcome.
  const existing = (
    await db.execute({
      sql: "SELECT DISTINCT outcome FROM pari_entries WHERE pool_id = ? AND person_id = ?",
      args: [poolId, personId],
    })
  ).rows as any[];
  const otherOutcome = existing.map((r) => r.outcome as string).find((o) => o !== outcome);
  if (otherOutcome) {
    return { ok: false, error: `you're already in the pot on ${otherOutcome} — can't split` };
  }

  const ts = nowIso();
  await db.execute({
    sql: "INSERT INTO pari_entries (pool_id, person_id, outcome, amount, created_at) VALUES (?,?,?,?,?)",
    args: [poolId, personId, outcome, amount, ts],
  });
  await db.execute({ sql: "UPDATE pari_pools SET updated_at = ? WHERE id = ?", args: [ts, poolId] });

  // Feed emit is best-effort — never load-bearing for the contribution above.
  await emitFeedEvent({
    type: "pari_contributed",
    actorId: personId,
    matchId,
    source: "manual",
    payload: { outcome, amount },
    dedupKey: null, // multiple contributions allowed; never dedup
  });
  return { ok: true };
}

// ---- Settlement ---------------------------------------------------------------

// Aggregate a pool's entries to one row per (person, outcome) with summed amount.
async function aggregateEntries(
  poolId: number,
): Promise<{ personId: number; manager: string | null; outcome: Outcome; amount: number }[]> {
  const rows = (
    await db.execute({
      sql: `SELECT pe.person_id, pe.outcome, SUM(pe.amount) AS amount, p.name AS manager
            FROM pari_entries pe
            LEFT JOIN people p ON p.id = pe.person_id
            WHERE pe.pool_id = ?
            GROUP BY pe.person_id, pe.outcome`,
      args: [poolId],
    })
  ).rows as any[];
  return rows.map((r) => ({
    personId: Number(r.person_id),
    manager: (r.manager ?? null) as string | null,
    outcome: r.outcome as Outcome,
    amount: Number(r.amount),
  }));
}

export async function settlePariPools(): Promise<{ settled: number; voided: number }> {
  await ensureSchema();
  const pools = (await db.execute("SELECT * FROM pari_pools WHERE status = 'open'")).rows as any[];
  if (pools.length === 0) return { settled: 0, voided: 0 };

  const matchIds = [...new Set(pools.map((p) => Number(p.match_id)))];
  const placeholders = matchIds.map(() => "?").join(",");
  const matches = (await db.execute({ sql: `SELECT * FROM matches WHERE id IN (${placeholders})`, args: matchIds })).rows as any[];
  const byId = new Map(matches.map((m) => [Number(m.id), m]));

  let settled = 0;
  let voided = 0;
  for (const pool of pools) {
    const m = byId.get(Number(pool.match_id));
    if (!m) continue;
    if (effectiveStatus(m) !== "post") continue; // pre OR live: leave the pot open

    const result = effectiveResult(m);
    if (!result) continue; // scores not in yet — can't determine the winner

    const poolId = Number(pool.id);
    const agg = await aggregateEntries(poolId);
    const pot = agg.reduce((s, a) => s + a.amount, 0);
    const winners = agg.filter((a) => a.outcome === result);
    const sw = winners.reduce((s, a) => s + a.amount, 0);
    const ts = nowIso();

    // No entries OR nobody backed the winner -> void (refund everyone).
    if (pot === 0 || sw === 0) {
      await db.execute({
        sql: "UPDATE pari_pools SET status='void', settled_at=?, updated_at=? WHERE id=?",
        args: [ts, ts, poolId],
      });
      await emitFeedEvent({
        type: "pari_void",
        actorId: null,
        matchId: Number(pool.match_id),
        source: "system",
        payload: { result, pot },
        dedupKey: "pari_void:" + poolId,
      });
      voided++;
      continue;
    }

    // Winners split the whole pot pro-rata to their contribution.
    await db.execute({
      sql: "UPDATE pari_pools SET status='settled', result=?, settled_at=?, updated_at=? WHERE id=?",
      args: [result, ts, ts, poolId],
    });
    const winnerPayouts = winners.map((w) => ({
      manager: w.manager,
      contributed: w.amount,
      payout: pot * (w.amount / sw), // fractional ok; the feed payload is descriptive
    }));
    await emitFeedEvent({
      type: "pari_settled",
      actorId: null,
      matchId: Number(pool.match_id),
      source: "system",
      payload: {
        result,
        pot,
        sw,
        winners: winnerPayouts.map((w) => ({ manager: w.manager, amount: w.payout })),
      },
      dedupKey: "pari_settled:" + poolId,
    });
    settled++;
  }
  return { settled, voided };
}

// ---- Unified ledger transfers -------------------------------------------------

// For every settled pari pool with a winner, expand the pot split into directed
// loser->winner transfers, so getLedger can fold them into the SAME Settle Up as
// the 3-spot pools. Each loser L (who contributed c_L on a losing outcome) owes
// each winner W_i a slice of c_L proportional to W_i's share of the winning side:
//   amount(L -> W_i) = c_L * (c_i / Sw)
// Summed over winners this is exactly c_L (each loser's whole stake redistributed
// to the winners), and summed over losers each winner receives
// (Sw_losers) * (c_i / Sw) — i.e. their pro-rata cut of everyone else's money,
// keeping their own stake. Amounts are fractional; getLedger rounds the nets.
export async function pariLedgerTransfers(): Promise<{ from: string; to: string; amount: number }[]> {
  await ensureSchema();
  const pools = (await db.execute("SELECT id, result FROM pari_pools WHERE status='settled' AND result IS NOT NULL")).rows as any[];
  const transfers: { from: string; to: string; amount: number }[] = [];

  for (const pool of pools) {
    const result = pool.result as Outcome;
    const agg = await aggregateEntries(Number(pool.id));
    const winners = agg.filter((a) => a.outcome === result && a.manager);
    const losers = agg.filter((a) => a.outcome !== result && a.manager);
    const sw = winners.reduce((s, a) => s + a.amount, 0);
    if (sw === 0 || winners.length === 0) continue; // void pool; nothing to settle

    for (const L of losers) {
      for (const W of winners) {
        transfers.push({ from: L.manager!, to: W.manager!, amount: L.amount * (W.amount / sw) });
      }
    }
  }
  return transfers;
}

// ---- Read views ---------------------------------------------------------------

export interface PariView {
  poolId: number;
  matchId: number;
  status: string; // open | settled | void
  result: Outcome | null;
  pot: number;
  outcomes: Record<Outcome, { total: number; backers: { manager: string; amount: number }[] }>;
  mine: { outcome: Outcome; amount: number } | null;
  match?: {
    homeName: string;
    awayName: string;
    homeCode: string | null;
    awayCode: string | null;
    kickoffUtc: string;
    status: string; // pre | in | post (raw)
    groupLetter: string | null;
  };
}

function blankOutcomes(): PariView["outcomes"] {
  return {
    home: { total: 0, backers: [] },
    draw: { total: 0, backers: [] },
    away: { total: 0, backers: [] },
  };
}

// A person's stake in a pool: their (single) outcome and summed amount, or null
// if they're not in / no person given. aggregateEntries already collapses to one
// row per (person, outcome), and the one-outcome rule means at most one matches.
function mineFromAgg(
  agg: { personId: number; outcome: Outcome; amount: number }[],
  personId?: number,
): PariView["mine"] {
  if (personId == null) return null;
  const row = agg.find((a) => a.personId === personId);
  return row ? { outcome: row.outcome, amount: row.amount } : null;
}

export async function getPariView(matchId: number, personId?: number): Promise<PariView | null> {
  await ensureSchema();
  const pool = (await db.execute({ sql: "SELECT * FROM pari_pools WHERE match_id = ?", args: [matchId] })).rows[0] as any;
  if (!pool) return null;

  const poolId = Number(pool.id);
  const agg = await aggregateEntries(poolId);

  const outcomes = blankOutcomes();
  let pot = 0;
  for (const a of agg) {
    outcomes[a.outcome].total += a.amount;
    outcomes[a.outcome].backers.push({ manager: a.manager ?? "—", amount: a.amount });
    pot += a.amount;
  }
  for (const o of OUTCOMES) outcomes[o].backers.sort((x, y) => y.amount - x.amount || x.manager.localeCompare(y.manager));

  return {
    poolId,
    matchId: Number(pool.match_id),
    status: pool.status as string,
    result: (pool.result ?? null) as Outcome | null,
    pot,
    outcomes,
    mine: mineFromAgg(agg, personId),
  };
}

export async function getAllPariViews(personId?: number): Promise<{ open: PariView[]; settled: PariView[] }> {
  await ensureSchema();
  const pools = (
    await db.execute(`
      SELECT pp.id, pp.match_id, pp.status, pp.result,
             m.home_name, m.away_name, m.home_code, m.away_code,
             m.kickoff_utc, m.status AS match_status, m.group_letter
      FROM pari_pools pp
      JOIN matches m ON m.id = pp.match_id
      WHERE pp.status IN ('open','settled')
      ORDER BY m.kickoff_utc DESC, pp.id DESC
    `)
  ).rows as any[];

  const views: PariView[] = [];
  for (const pool of pools) {
    const poolId = Number(pool.id);
    const agg = await aggregateEntries(poolId);
    const outcomes = blankOutcomes();
    let pot = 0;
    for (const a of agg) {
      outcomes[a.outcome].total += a.amount;
      outcomes[a.outcome].backers.push({ manager: a.manager ?? "—", amount: a.amount });
      pot += a.amount;
    }
    for (const o of OUTCOMES) outcomes[o].backers.sort((x, y) => y.amount - x.amount || x.manager.localeCompare(y.manager));

    views.push({
      poolId,
      matchId: Number(pool.match_id),
      status: pool.status as string,
      result: (pool.result ?? null) as Outcome | null,
      pot,
      outcomes,
      mine: mineFromAgg(agg, personId),
      match: {
        homeName: pool.home_name,
        awayName: pool.away_name,
        homeCode: pool.home_code,
        awayCode: pool.away_code,
        kickoffUtc: pool.kickoff_utc,
        status: pool.match_status,
        groupLetter: pool.group_letter,
      },
    });
  }

  return {
    open: views.filter((v) => v.status === "open"),
    settled: views.filter((v) => v.status === "settled"),
  };
}
