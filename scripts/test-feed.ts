/* eslint-disable @typescript-eslint/no-explicit-any */
// Test of the activity-feed data foundation (lib/feed.ts + the bets.ts emits).
//
// SAFETY: like test-bets / test-autobet, this never mutates a canonical row. It
// INSERTs SYNTHETIC matches (espn_event_id 'TEST-FEED-N', collision-proof via a
// monotonic counter), creates pools only on those matches, and in `finally`
// deletes the feed_events + pools + matches it made. Canonical data is untouched.
import { db, ensureSchema } from "../lib/db";
import { createPool, takeSpot, cancelPool, editPool } from "../lib/bets";
import { emitFeedEvent, backfillFeedEvents, getFeed, settlePayload } from "../lib/feed";
import { type Outcome } from "../lib/betting";

let ok = true;
const check = (c: boolean, label: string) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) ok = false; };

async function main() {
  await ensureSchema();

  const people = (await db.execute("SELECT id, name FROM people")).rows as any[];
  const pid = (n: string) => Number(people.find((p) => p.name === n).id);
  const Mattie = pid("Mattie"), Brian = pid("Brian"), Dereck = pid("Dereck");

  // Snapshot the max feed_events id so finally can remove ANY row this test
  // caused — including canonical backfill rows — leaving feed_events untouched.
  const baselineMaxId = Number(
    (await db.execute("SELECT COALESCE(MAX(id), 0) AS m FROM feed_events")).rows[0].m,
  );

  const synthIds: number[] = [];
  const createdPools: number[] = [];
  let seq = 0;
  const makeMatch = async (status: string): Promise<number> => {
    seq += 1;
    const marker = `TEST-FEED-${seq}`;
    const res = await db.execute({
      sql: `INSERT INTO matches
              (espn_event_id, status, kickoff_utc, odds_home, odds_draw, odds_away, home_name, away_name, home_code, away_code)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [marker, status, new Date().toISOString(), "-150", "+275", "+400", `FeedHome${seq}`, `FeedAway${seq}`, "FHM", "FAW"],
    });
    const id = Number(res.lastInsertRowid);
    synthIds.push(id);
    return id;
  };

  // All feed rows tied to this test's synthetic pools/matches.
  const feedForPool = async (poolId: number) =>
    (await db.execute({ sql: "SELECT * FROM feed_events WHERE pool_id = ? ORDER BY id", args: [poolId] })).rows as any[];
  const ev = (rows: any[], type: string) => rows.find((r) => r.type === type);
  const payloadOf = (row: any) => (row?.payload ? JSON.parse(row.payload) : null);

  try {
    // --- createPool -> bet_opened -----------------------------------------
    const mA = await makeMatch("pre");
    const c1 = await createPool({ matchId: mA, creatorPersonId: Mattie, outcome: "home", buyin: 20 });
    check(c1.ok === true, "createPool ok");
    const pool1 = (c1 as any).poolId; createdPools.push(pool1);
    let rows1 = await feedForPool(pool1);
    const opened = ev(rows1, "bet_opened");
    check(!!opened, "bet_opened emitted");
    check(opened?.actor_id === Mattie, "bet_opened actor = creator");
    check(opened?.dedup_key === "open:" + pool1, "bet_opened dedup_key open:<poolId>");
    const op = payloadOf(opened);
    check(op?.outcome === "home" && op?.amount === 20, "bet_opened payload {outcome, amount}");

    // --- takeSpot 2nd -> bet_joined (no fill yet) -------------------------
    check((await takeSpot({ poolId: pool1, personId: Brian, outcome: "away" })).ok === true, "Brian joins away");
    rows1 = await feedForPool(pool1);
    const joined = ev(rows1, "bet_joined");
    check(!!joined && joined.actor_id === Brian, "bet_joined emitted (actor = taker)");
    check(joined?.dedup_key === "take:" + pool1 + ":away", "bet_joined dedup_key take:<poolId>:<outcome>");
    check(!ev(rows1, "bet_filled"), "no bet_filled at 2 spots");

    // --- takeSpot 3rd -> bet_joined THEN bet_filled -----------------------
    check((await takeSpot({ poolId: pool1, personId: Dereck, outcome: "draw" })).ok === true, "Dereck joins draw (fills)");
    rows1 = await feedForPool(pool1);
    const filled = ev(rows1, "bet_filled");
    check(!!filled, "bet_filled emitted on the filling take");
    check(filled?.actor_id == null && filled?.source === "system", "bet_filled actor null, source system");
    check(filled?.dedup_key === "filled:" + pool1, "bet_filled dedup_key filled:<poolId>");
    check(rows1.filter((r) => r.type === "bet_joined").length === 2, "two bet_joined rows (away, draw)");

    // --- editPool -> bet_edited with old/new ------------------------------
    const mB = await makeMatch("pre");
    const c2 = await createPool({ matchId: mB, creatorPersonId: Mattie, outcome: "home", buyin: 20 });
    const pool2 = (c2 as any).poolId; createdPools.push(pool2);
    check((await editPool({ poolId: pool2, personId: Mattie, buyin: 40 })).ok === true, "editPool ok");
    const edited = ev(await feedForPool(pool2), "bet_edited");
    check(!!edited && edited.dedup_key == null, "bet_edited emitted, dedup_key NULL");
    const ed = payloadOf(edited);
    check(ed?.oldAmount === 20 && ed?.newAmount === 40 && ed?.outcome === "home", "bet_edited payload {outcome, oldAmount, newAmount}");

    // --- cancelPool -> bet_canceled ---------------------------------------
    const mC = await makeMatch("pre");
    const c3 = await createPool({ matchId: mC, creatorPersonId: Mattie, outcome: "home", buyin: 12 });
    const pool3 = (c3 as any).poolId; createdPools.push(pool3);
    check((await cancelPool({ poolId: pool3, personId: Mattie })).ok === true, "cancelPool ok");
    const canceled = ev(await feedForPool(pool3), "bet_canceled");
    check(!!canceled && canceled.dedup_key === "cancel:" + pool3, "bet_canceled emitted with dedup_key");

    // --- settle path -> bet_settled with flow (via the shared payload) ----
    // pool1 is full (Mattie home, Brian away, Dereck draw); settle to a home win.
    const settleRow = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [pool1] })).rows[0] as any;
    const mgr: Record<Outcome, string | null> = { home: "Mattie", draw: "Dereck", away: "Brian" };
    const doSettleEmit = () =>
      emitFeedEvent({
        type: "bet_settled",
        actorId: null,
        matchId: Number(settleRow.match_id),
        poolId: pool1,
        source: "system",
        payload: settlePayload(settleRow, "home", mgr),
        dedupKey: "settle:" + pool1,
      });
    await doSettleEmit();
    const settled = ev(await feedForPool(pool1), "bet_settled");
    check(!!settled, "bet_settled emitted");
    const sp = payloadOf(settled);
    check(sp?.result === "home" && Array.isArray(sp?.flow) && sp.flow.length === 2, "bet_settled payload has result + flow entries");
    check(sp.flow.every((e: any) => e.to === "home"), "settle flow points losers -> winner");
    check(Array.isArray(sp?.spots) && sp.spots.length === 3, "settle payload lists all filled spots");

    // --- IDEMPOTENCY: settle-emit twice does not duplicate ----------------
    const cnt = async (key: string) =>
      Number((await db.execute({ sql: "SELECT COUNT(*) n FROM feed_events WHERE dedup_key=?", args: [key] })).rows[0].n);
    await doSettleEmit();
    check((await cnt("settle:" + pool1)) === 1, "settle emit idempotent (single row for dedup_key)");

    // --- IDEMPOTENCY: backfill twice does not duplicate -------------------
    const totalFor = async () => {
      const ids = createdPools;
      const ph = ids.map(() => "?").join(",");
      return Number((await db.execute({ sql: `SELECT COUNT(*) n FROM feed_events WHERE pool_id IN (${ph})`, args: ids })).rows[0].n);
    };
    await backfillFeedEvents();
    const afterFirst = await totalFor();
    await backfillFeedEvents();
    const afterSecond = await totalFor();
    check(afterFirst === afterSecond, `backfill idempotent (count stable: ${afterFirst})`);

    // --- getFeed: newest-first, joined names/codes, openSpots -------------
    const feed = await getFeed(200);
    const mine = feed.filter((f) => createdPools.includes(f.pool?.id ?? -1));
    check(mine.length > 0, "getFeed returns this test's events");
    // newest-first overall
    let ordered = true;
    for (let i = 1; i < feed.length; i++) {
      const a = feed[i - 1], b = feed[i];
      if (a.ts < b.ts || (a.ts === b.ts && a.id < b.id)) { ordered = false; break; }
    }
    check(ordered, "getFeed newest-first (ts DESC, id DESC)");
    const openedItem = feed.find((f) => f.pool?.id === pool1 && f.type === "bet_opened");
    check(openedItem?.actor === "Mattie", "getFeed joins actor name");
    check(openedItem?.match?.homeCode === "FHM" && openedItem?.match?.awayCode === "FAW", "getFeed joins match home/away codes");
    // pool2 was edited (Mattie alone holds home) -> two open spots surfaced.
    const editItem = feed.find((f) => f.pool?.id === pool2 && f.type === "bet_edited");
    check(editItem?.pool?.filledCount === 1, "getFeed pool filledCount reflects current state");
    const openOutcomes = (editItem?.pool?.openSpots ?? []).map((s) => s.outcome).sort();
    check(JSON.stringify(openOutcomes) === JSON.stringify(["away", "draw"]), "getFeed openSpots = the still-open outcomes");
    check((editItem?.pool?.openSpots ?? []).every((s) => typeof s.buyin === "number" && s.buyin >= 1), "getFeed openSpots carry buy-ins");

    // --- money-path safety: emit cannot throw even with garbage -----------
    let threw = false;
    try {
      // Force an internal failure by passing a circular payload (JSON.stringify throws).
      const circular: any = {}; circular.self = circular;
      await emitFeedEvent({ type: "bet_opened", payload: circular, dedupKey: null });
    } catch { threw = true; }
    check(!threw, "emitFeedEvent swallows internal errors (never rejects)");
  } finally {
    // Cleanup: feed_events for our pools/matches, then pools, then matches.
    if (createdPools.length) {
      const ph = createdPools.map(() => "?").join(",");
      await db.execute(`DELETE FROM feed_events WHERE pool_id IN (${ph})`, createdPools as any);
      await db.execute(`DELETE FROM bet_pools WHERE id IN (${ph})`, createdPools as any);
    }
    if (synthIds.length) {
      const ph = synthIds.map(() => "?").join(",");
      await db.execute(`DELETE FROM feed_events WHERE match_id IN (${ph})`, synthIds as any);
      await db.execute(`DELETE FROM bet_pools WHERE match_id IN (${ph})`, synthIds as any);
      await db.execute(`DELETE FROM matches WHERE id IN (${ph})`, synthIds as any);
    }
    // Remove every feed row created during this run (canonical backfill rows
    // included), so feed_events is left exactly as we found it.
    await db.execute({ sql: "DELETE FROM feed_events WHERE id > ?", args: [baselineMaxId] });
    // Belt + suspenders by marker.
    await db.execute("DELETE FROM feed_events WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE 'TEST-FEED-%')");
    await db.execute("DELETE FROM bet_pools WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE 'TEST-FEED-%')");
    await db.execute("DELETE FROM matches WHERE espn_event_id LIKE 'TEST-FEED-%'");
    console.log("(cleaned up test feed events + pools + synthetic matches)");
  }

  console.log(ok ? "\nPASS ✅ feed data foundation sound" : "\nFAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
