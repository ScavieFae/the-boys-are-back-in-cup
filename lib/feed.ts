/* eslint-disable @typescript-eslint/no-explicit-any */
// Activity feed: the data foundation. An append-only event log emitted alongside
// the bet + match lifecycle. Three guarantees make this safe to wire into the
// money path:
//   1. emitFeedEvent is BEST-EFFORT — its whole body is wrapped in try/catch and
//      swallows every error, so a feed insert can never reject and therefore can
//      never roll back or break the caller's bet mutation.
//   2. Inserts use INSERT OR IGNORE keyed on dedup_key, so settle/match-transition
//      emits that run repeatedly (settleAllPools, syncFixtures) are idempotent.
//   3. Backfill reconstructs the historically-knowable events (opens + settles)
//      from bet_pools, also via dedup_key, so the feed is never empty on launch.
import { db, ensureSchema } from "./db";
import { settlePool, OUTCOMES, type Outcome } from "./betting";

const nowIso = () => new Date().toISOString();

export type FeedEventType =
  | "bet_opened"
  | "bet_joined"
  | "bet_filled"
  | "bet_edited"
  | "bet_canceled"
  | "bet_settled"
  | "bet_voided"
  | "match_started"
  | "match_final"
  | "pari_contributed"
  | "pari_settled"
  | "pari_void";

export interface FeedItem {
  id: number;
  ts: string;
  type: FeedEventType;
  source: string; // manual | auto | system
  runId: string | null;
  actor: string | null;
  match: {
    id: number;
    homeName: string | null;
    awayName: string | null;
    homeCode: string | null;
    awayCode: string | null;
    status: string | null; // pre | in | post
  } | null;
  pool: {
    id: number;
    status: string; // open | settled | void
    filledCount: number;
    openSpots: { outcome: Outcome; buyin: number }[];
  } | null;
  payload: any;
}

// Best-effort emit. NEVER throws — a feed failure must not touch the caller's
// transaction. Duplicate dedup_key is a silent no-op (INSERT OR IGNORE).
export async function emitFeedEvent(e: {
  ts?: string;
  type: FeedEventType;
  actorId?: number | null;
  matchId?: number | null;
  poolId?: number | null;
  source?: "manual" | "auto" | "system";
  runId?: string | null;
  payload?: object;
  dedupKey?: string | null;
}): Promise<void> {
  try {
    await ensureSchema();
    const now = nowIso();
    await db.execute({
      sql: `INSERT OR IGNORE INTO feed_events
              (ts, type, actor_id, match_id, pool_id, source, run_id, payload, dedup_key, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        e.ts ?? now,
        e.type,
        e.actorId ?? null,
        e.matchId ?? null,
        e.poolId ?? null,
        e.source ?? "manual",
        e.runId ?? null,
        e.payload != null ? JSON.stringify(e.payload) : null,
        e.dedupKey ?? null,
        now,
      ],
    });
  } catch (err) {
    // Swallow — best-effort. The feed is never load-bearing for a bet mutation.
    console.error("emitFeedEvent failed (swallowed):", err);
  }
}

// Build the settle payload shared by the live settle path and backfill, so a
// renderer can compose "Winner (PICK,+$X) beat Loser (PICK,-$Y)...". `p` is a raw
// bet_pools row; `mgr` maps each outcome to its manager name (null = open spot).
export function settlePayload(
  p: any,
  result: Outcome,
  mgr: Record<Outcome, string | null>,
): { result: Outcome; spots: { outcome: Outcome; manager: string | null; amount: number }[]; flow: any[] } {
  const PERSON_COL: Record<Outcome, string> = {
    home: "home_person_id",
    draw: "draw_person_id",
    away: "away_person_id",
  };
  const spots = OUTCOMES.filter((o) => p[PERSON_COL[o]] != null).map((o) => ({
    outcome: o,
    manager: mgr[o],
    amount: Number(p[`buyin_${o}`]),
  }));
  const filled: Partial<Record<Outcome, number>> = {};
  for (const o of OUTCOMES) if (p[PERSON_COL[o]] != null) filled[o] = Number(p[`buyin_${o}`]);
  const s = settlePool(filled, result);
  const flow = s.status === "win" ? s.entries : [];
  return { result, spots, flow };
}

// ---- Backfill -----------------------------------------------------------------

// Reconstruct the historically-knowable feed from bet_pools: one bet_opened per
// pool (at its created_at) and one bet_settled per settled pool (at its
// settled_at). Idempotent via dedup_key — running twice inserts nothing new.
// Joins/edits/filled/started aren't reconstructable and are intentionally skipped.
export async function backfillFeedEvents(): Promise<{ inserted: number }> {
  await ensureSchema();

  const before = Number(
    (await db.execute("SELECT COUNT(*) AS n FROM feed_events")).rows[0]?.n ?? 0,
  );

  const pools = (
    await db.execute(`
      SELECT bp.*,
             hp.name AS home_mgr, dp.name AS draw_mgr, ap.name AS away_mgr
      FROM bet_pools bp
      LEFT JOIN people hp ON hp.id = bp.home_person_id
      LEFT JOIN people dp ON dp.id = bp.draw_person_id
      LEFT JOIN people ap ON ap.id = bp.away_person_id
    `)
  ).rows as any[];

  const PERSON_COL: Record<Outcome, string> = {
    home: "home_person_id",
    draw: "draw_person_id",
    away: "away_person_id",
  };

  for (const p of pools) {
    const poolId = Number(p.id);
    // The creator's held spot is the outcome whose person_id == created_by.
    const creatorOutcome = OUTCOMES.find((o) => Number(p[PERSON_COL[o]]) === Number(p.created_by));
    if (creatorOutcome) {
      await emitFeedEvent({
        ts: p.created_at,
        type: "bet_opened",
        actorId: Number(p.created_by),
        matchId: Number(p.match_id),
        poolId,
        source: "manual",
        payload: { outcome: creatorOutcome, amount: Number(p[`buyin_${creatorOutcome}`]) },
        dedupKey: "open:" + poolId,
      });
    }

    if (p.status === "settled" && p.result) {
      const mgr: Record<Outcome, string | null> = {
        home: p.home_mgr ?? null,
        draw: p.draw_mgr ?? null,
        away: p.away_mgr ?? null,
      };
      await emitFeedEvent({
        ts: p.settled_at ?? p.updated_at ?? p.created_at,
        type: "bet_settled",
        actorId: null,
        matchId: Number(p.match_id),
        poolId,
        source: "system",
        payload: settlePayload(p, p.result as Outcome, mgr),
        dedupKey: "settle:" + poolId,
      });
    }
  }

  const after = Number(
    (await db.execute("SELECT COUNT(*) AS n FROM feed_events")).rows[0]?.n ?? 0,
  );
  return { inserted: after - before };
}

// ---- Read API -----------------------------------------------------------------

// Shared SELECT/JOIN body for the feed read views. Callers append a WHERE/ORDER
// /LIMIT and bind args; the column list (and therefore shapeFeedRow) stays in sync.
const FEED_SELECT = /* sql */ `
  SELECT fe.id, fe.ts, fe.type, fe.source, fe.run_id, fe.payload,
         pe.name AS actor_name,
         m.id AS m_id, m.home_name, m.away_name, m.home_code, m.away_code, m.status AS m_status,
         bp.id AS bp_id, bp.status AS bp_status,
         bp.buyin_home, bp.buyin_draw, bp.buyin_away,
         bp.home_person_id, bp.draw_person_id, bp.away_person_id
  FROM feed_events fe
  LEFT JOIN people pe ON pe.id = fe.actor_id
  LEFT JOIN matches m ON m.id = fe.match_id
  LEFT JOIN bet_pools bp ON bp.id = fe.pool_id
`;

const FEED_PERSON_COL: Record<Outcome, string> = {
  home: "home_person_id",
  draw: "draw_person_id",
  away: "away_person_id",
};

function shapeFeedRow(r: any): FeedItem {
  let payload: any = null;
  if (r.payload != null) {
    try {
      payload = JSON.parse(r.payload as string);
    } catch {
      payload = null;
    }
  }

  const match =
    r.m_id != null
      ? {
          id: Number(r.m_id),
          homeName: r.home_name ?? null,
          awayName: r.away_name ?? null,
          homeCode: r.home_code ?? null,
          awayCode: r.away_code ?? null,
          status: r.m_status ?? null,
        }
      : null;

  let pool: FeedItem["pool"] = null;
  if (r.bp_id != null) {
    const filledCount = OUTCOMES.filter((o) => r[FEED_PERSON_COL[o]] != null).length;
    const openSpots = OUTCOMES.filter((o) => r[FEED_PERSON_COL[o]] == null).map((o) => ({
      outcome: o,
      buyin: Number(r[`buyin_${o}`]),
    }));
    pool = {
      id: Number(r.bp_id),
      status: r.bp_status as string,
      filledCount,
      openSpots,
    };
  }

  return {
    id: Number(r.id),
    ts: r.ts as string,
    type: r.type as FeedEventType,
    source: r.source as string,
    runId: r.run_id ?? null,
    actor: r.actor_name ?? null,
    match,
    pool,
    payload,
  };
}

export async function getFeed(limit = 30): Promise<FeedItem[]> {
  await ensureSchema();

  const count = Number(
    (await db.execute("SELECT COUNT(*) AS n FROM feed_events")).rows[0]?.n ?? 0,
  );
  // Never launch an empty feed — we can't run a prod script, so backfill on first
  // read. Idempotent, so this is a one-time effective cost.
  if (count === 0) await backfillFeedEvents();

  const rows = (
    await db.execute({
      sql: `${FEED_SELECT} ORDER BY fe.ts DESC, fe.id DESC LIMIT ?`,
      args: [limit],
    })
  ).rows as any[];

  return rows.map(shapeFeedRow);
}

// The full activity feed for one match, newest-first. Same shaping as getFeed,
// scoped to fe.match_id. No backfill trigger here — getFeed owns that one-time
// cost, and a per-match view legitimately can be empty.
export async function getFeedForMatch(matchId: number, limit = 50): Promise<FeedItem[]> {
  await ensureSchema();
  const rows = (
    await db.execute({
      sql: `${FEED_SELECT} WHERE fe.match_id = ? ORDER BY fe.ts DESC, fe.id DESC LIMIT ?`,
      args: [matchId, limit],
    })
  ).rows as any[];
  return rows.map(shapeFeedRow);
}
