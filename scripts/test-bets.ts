/* eslint-disable @typescript-eslint/no-explicit-any */
import { db, ensureSchema } from "../lib/db";
import { createPool, takeSpot, cancelPool, editPool, settleAllPools, getLedger } from "../lib/bets";
import { deVig, computeBuyins } from "../lib/betting";

let ok = true;
const check = (c: boolean, label: string) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) ok = false; };

async function main() {
  await ensureSchema();

  const people = (await db.execute("SELECT id, name FROM people")).rows as any[];
  const pid = (n: string) => Number(people.find((p) => p.name === n).id);
  const Mattie = pid("Mattie"), Brian = pid("Brian"), Dereck = pid("Dereck");

  const matches = (await db.execute(
    "SELECT id, odds_home, odds_draw, odds_away FROM matches WHERE status='pre' AND odds_home IS NOT NULL LIMIT 3",
  )).rows as any[];
  const [A, B, C] = matches.map((m) => Number(m.id));

  const createdPools: number[] = [];
  const touchedMatches = [A, B, C];

  // Synthetic matches for the live/post betting-window checks. Pure INSERTs with a
  // unique espn_event_id marker; deleted in `finally`, so canonical rows are untouched.
  const synthIds: number[] = [];
  let synthSeq = 0;
  const makeSynthMatch = async (status: string): Promise<number> => {
    const marker = `TEST-BETS-${status}-${Date.now()}-${synthSeq++}`;
    const res = await db.execute({
      sql: `INSERT INTO matches
              (espn_event_id, status, kickoff_utc, odds_home, odds_draw, odds_away, home_name, away_name)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [marker, status, new Date().toISOString(), "-150", "+275", "+400", "SynthHome", "SynthAway"],
    });
    const id = Number(res.lastInsertRowid);
    synthIds.push(id);
    return id;
  };

  try {
    // --- Pool 1 on match A: 3-spot, Mattie(home) Brian(away) Dereck(draw) ---
    const c1 = await createPool({ matchId: A, creatorPersonId: Mattie, outcome: "home", buyin: 20 });
    check(c1.ok === true, "create pool (Mattie home $20)");
    const pool1 = (c1 as any).poolId;
    createdPools.push(pool1);

    const p1 = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [pool1] })).rows[0] as any;
    check(Number(p1.buyin_home) === 20, "creator buy-in exact ($20)");
    check(Number(p1.buyin_away) >= 1 && Number(p1.buyin_draw) >= 1, "derived buy-ins >= $1");

    check((await takeSpot({ poolId: pool1, personId: Brian, outcome: "away" })).ok === true, "Brian takes away");
    const dup = await takeSpot({ poolId: pool1, personId: Brian, outcome: "draw" });
    check(!dup.ok && /already hold/.test((dup as any).error), "reject: same person, second spot");
    const taken = await takeSpot({ poolId: pool1, personId: Dereck, outcome: "away" });
    check(!taken.ok && /already taken/.test((taken as any).error), "reject: spot already taken");
    check((await takeSpot({ poolId: pool1, personId: Dereck, outcome: "draw" })).ok === true, "Dereck takes draw (3 spots)");
    const cantCancel = await cancelPool({ poolId: pool1, personId: Mattie });
    check(!cantCancel.ok && /can't cancel/.test((cantCancel as any).error), "reject: cancel after others joined");

    // --- Pool 2 on match B: 2-spot (home, away), draw left open ---
    const c2 = await createPool({ matchId: B, creatorPersonId: Brian, outcome: "home", buyin: 15 });
    const pool2 = (c2 as any).poolId; createdPools.push(pool2);
    check((await takeSpot({ poolId: pool2, personId: Dereck, outcome: "away" })).ok === true, "pool2: Dereck takes away (2 spots, draw open)");

    // --- Pool 3 on match C: 1-spot only ---
    const c3 = await createPool({ matchId: C, creatorPersonId: Mattie, outcome: "home", buyin: 10 });
    const pool3 = (c3 as any).poolId; createdPools.push(pool3);

    // --- Force results via the override mechanism ---
    await db.execute({ sql: "UPDATE matches SET manual_override=1, manual_status='post', manual_home_score=2, manual_away_score=0 WHERE id=?", args: [A] }); // home win
    await db.execute({ sql: "UPDATE matches SET manual_override=1, manual_status='post', manual_home_score=1, manual_away_score=1 WHERE id=?", args: [B] }); // draw
    await db.execute({ sql: "UPDATE matches SET manual_override=1, manual_status='post', manual_home_score=1, manual_away_score=0 WHERE id=?", args: [C] }); // any

    const sr = await settleAllPools();
    check(sr.settled === 2 && sr.voided === 1, `settle: 2 settled, 1 voided (got ${sr.settled}/${sr.voided})`);

    const r1 = (await db.execute({ sql: "SELECT status,result FROM bet_pools WHERE id=?", args: [pool1] })).rows[0] as any;
    check(r1.status === "settled" && r1.result === "home", "pool1 settled -> home");
    const r2 = (await db.execute({ sql: "SELECT status,result FROM bet_pools WHERE id=?", args: [pool2] })).rows[0] as any;
    check(r2.status === "settled" && r2.result === "draw", "pool2 settled -> draw (push, empty draw spot)");
    const r3 = (await db.execute({ sql: "SELECT status FROM bet_pools WHERE id=?", args: [pool3] })).rows[0] as any;
    check(r3.status === "void", "pool3 void (only 1 spot)");

    // --- Betting window: allowed on LIVE ('in'), blocked on finished ('post') ---
    const liveMatch = await makeSynthMatch("in");
    const postMatch = await makeSynthMatch("post");

    // createPool succeeds on a live match.
    const liveCreate = await createPool({ matchId: liveMatch, creatorPersonId: Mattie, outcome: "home", buyin: 10 });
    check(liveCreate.ok === true, "createPool SUCCEEDS on a live ('in') match");
    if (liveCreate.ok && (liveCreate as any).poolId) createdPools.push((liveCreate as any).poolId);

    // takeSpot succeeds on that live pool.
    if (liveCreate.ok) {
      const liveTake = await takeSpot({ poolId: (liveCreate as any).poolId, personId: Brian, outcome: "away" });
      check(liveTake.ok === true, "takeSpot SUCCEEDS on a live ('in') match");
    } else {
      check(false, "takeSpot SUCCEEDS on a live ('in') match (skipped — create failed)");
    }

    // createPool fails on a finished match.
    const postCreate = await createPool({ matchId: postMatch, creatorPersonId: Mattie, outcome: "home", buyin: 10 });
    check(!postCreate.ok && /finished/.test((postCreate as any).error), "createPool FAILS on a finished ('post') match");
    if (postCreate.ok && (postCreate as any).poolId) createdPools.push((postCreate as any).poolId);

    // takeSpot fails on a finished match: seed an open pool on a live match, then
    // flip the match to 'post' and confirm the spot can no longer be taken.
    const seedForPost = await createPool({ matchId: liveMatch, creatorPersonId: Dereck, outcome: "home", buyin: 10 });
    if (seedForPost.ok) {
      createdPools.push((seedForPost as any).poolId);
      await db.execute({ sql: "UPDATE matches SET status='post' WHERE id=?", args: [liveMatch] });
      const postTake = await takeSpot({ poolId: (seedForPost as any).poolId, personId: Brian, outcome: "away" });
      check(!postTake.ok && /finished/.test((postTake as any).error), "takeSpot FAILS once the match is finished ('post')");
    } else {
      check(false, "takeSpot FAILS once the match is finished ('post') (skipped — seed failed)");
    }

    // --- Void/settle TIMING: nothing resolves while a match is live ('in'),
    // only at full-time ('post'). Exercises the changed settleAllPools branch. ---
    const timingLive = await makeSynthMatch("in");

    // 1-spot pool on a LIVE match: must NOT void — still joinable.
    const tcVoid = await createPool({ matchId: timingLive, creatorPersonId: Mattie, outcome: "home", buyin: 10 });
    check(tcVoid.ok === true, "timing: create 1-spot pool on live match");
    const voidPool = (tcVoid as any).poolId; createdPools.push(voidPool);

    // 2-spot pool on the same LIVE match: must NOT settle while live.
    const tcSettle = await createPool({ matchId: timingLive, creatorPersonId: Brian, outcome: "home", buyin: 12 });
    const settlePoolId = (tcSettle as any).poolId; createdPools.push(settlePoolId);
    check((await takeSpot({ poolId: settlePoolId, personId: Dereck, outcome: "away" })).ok === true, "timing: 2-spot pool seeded on live match");

    // settleAllPools is global, so the aggregate counts can include other test
    // pools; assert on THESE pools' statuses, which exercise the live branch.
    await settleAllPools();
    const voidStillOpen = (await db.execute({ sql: "SELECT status FROM bet_pools WHERE id=?", args: [voidPool] })).rows[0] as any;
    check(voidStillOpen.status === "open", "timing: 1-spot pool stays OPEN while match is live ('in')");
    const settleStillOpen = (await db.execute({ sql: "SELECT status FROM bet_pools WHERE id=?", args: [settlePoolId] })).rows[0] as any;
    check(settleStillOpen.status === "open", "timing: 2-spot pool stays OPEN while match is live ('in')");

    // Flip to full-time with a home win: 1-spot voids, 2-spot settles.
    await db.execute({ sql: "UPDATE matches SET status='post', home_score=2, away_score=0 WHERE id=?", args: [timingLive] });
    await settleAllPools();
    const voidNow = (await db.execute({ sql: "SELECT status FROM bet_pools WHERE id=?", args: [voidPool] })).rows[0] as any;
    check(voidNow.status === "void", "timing: 1-spot pool VOIDS once match is final ('post')");
    const settleNow = (await db.execute({ sql: "SELECT status,result FROM bet_pools WHERE id=?", args: [settlePoolId] })).rows[0] as any;
    check(settleNow.status === "settled" && settleNow.result === "home", "timing: 2-spot pool SETTLES once match is final ('post')");

    // --- Ledger ---
    const led = await getLedger();
    const owesMattie = led.debts.filter((d) => d.to === "Mattie");
    const fromBrian = owesMattie.find((d) => d.from === "Brian");
    const fromDereck = owesMattie.find((d) => d.from === "Dereck");
    check(fromBrian?.amount === Number(p1.buyin_away), `Brian owes Mattie $${p1.buyin_away} (away buy-in)`);
    check(fromDereck?.amount === Number(p1.buyin_draw), `Dereck owes Mattie $${p1.buyin_draw} (draw buy-in)`);
    const mattieNet = led.totals.find((t) => t.manager === "Mattie")?.net;
    check(mattieNet === Number(p1.buyin_away) + Number(p1.buyin_draw), `Mattie net winnings +$${mattieNet}`);
    check(led.pushes >= 1, "ledger counts the push");

    // --- EDIT an open, unclaimed pool: re-prices, sets edited_at -------------
    const editMatch = await makeSynthMatch("pre");
    const ce = await createPool({ matchId: editMatch, creatorPersonId: Mattie, outcome: "home", buyin: 20 });
    check(ce.ok === true, "edit: create unclaimed pool (Mattie home $20)");
    const editPoolId = (ce as any).poolId; createdPools.push(editPoolId);
    const beforeEdit = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [editPoolId] })).rows[0] as any;

    const ed = await editPool({ poolId: editPoolId, personId: Mattie, buyin: 40 });
    check(ed.ok === true, "edit: succeeds on unclaimed pool");
    const afterEdit = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [editPoolId] })).rows[0] as any;
    check(Number(afterEdit.buyin_home) === 40, "edit: creator's spot equals exact new buy-in ($40)");
    // Re-price matches the engine's own math on the current line ($40 stake).
    const reprobs = deVig({ home: "-150", draw: "+275", away: "+400" })!;
    const expected = computeBuyins(reprobs, "home", 40);
    check(Number(afterEdit.buyin_away) === Math.max(1, expected.away) && Number(afterEdit.buyin_draw) === Math.max(1, expected.draw),
      "edit: the two non-creator spots re-priced to the current line");
    check(Number(afterEdit.buyin_draw) !== Number(beforeEdit.buyin_draw), "edit: non-creator buy-ins actually changed");
    check(afterEdit.edited_at != null, "edit: edited_at is set");

    // --- EDIT after a second person joins: fails, pool unchanged ------------
    check((await takeSpot({ poolId: editPoolId, personId: Brian, outcome: "away" })).ok === true, "edit: Brian joins the pool");
    const joinedSnap = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [editPoolId] })).rows[0] as any;
    const edJoined = await editPool({ poolId: editPoolId, personId: Mattie, buyin: 99 });
    check(!edJoined.ok && /already joined/.test((edJoined as any).error), "edit: FAILS after someone joined");
    const stillSnap = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [editPoolId] })).rows[0] as any;
    check(Number(stillSnap.buyin_home) === Number(joinedSnap.buyin_home), "edit: pool unchanged after the rejected edit");

    // --- EDIT by a non-creator: fails --------------------------------------
    const editMatch2 = await makeSynthMatch("pre");
    const ce2 = await createPool({ matchId: editMatch2, creatorPersonId: Mattie, outcome: "home", buyin: 20 });
    const editPool2 = (ce2 as any).poolId; createdPools.push(editPool2);
    const edNonCreator = await editPool({ poolId: editPool2, personId: Brian, buyin: 30 });
    check(!edNonCreator.ok && /only the creator/.test((edNonCreator as any).error), "edit: FAILS for a non-creator");

    // --- EDIT on a finished (post) match: fails ----------------------------
    const editMatch3 = await makeSynthMatch("pre");
    const ce3 = await createPool({ matchId: editMatch3, creatorPersonId: Mattie, outcome: "home", buyin: 20 });
    const editPool3 = (ce3 as any).poolId; createdPools.push(editPool3);
    await db.execute({ sql: "UPDATE matches SET status='post' WHERE id=?", args: [editMatch3] });
    const edPost = await editPool({ poolId: editPool3, personId: Mattie, buyin: 30 });
    check(!edPost.ok && /finished/.test((edPost as any).error), "edit: FAILS on a finished ('post') match");

    // --- EDIT with buyin < 1: fails ----------------------------------------
    const edBad = await editPool({ poolId: editPool2, personId: Mattie, buyin: 0 });
    check(!edBad.ok && /whole dollar/.test((edBad as any).error), "edit: FAILS with buy-in < $1");
  } finally {
    // cleanup: drop test pools, clear forced overrides. Feed events reference
    // bet_pools (FK), so clear them first or the pool deletes fail.
    if (createdPools.length) {
      const uniq = [...new Set(createdPools)];
      await db.execute(`DELETE FROM feed_events WHERE pool_id IN (${uniq.map(() => "?").join(",")})`, uniq as any);
      await db.execute(`DELETE FROM bet_pools WHERE id IN (${uniq.map(() => "?").join(",")})`, uniq as any);
    }
    for (const m of touchedMatches) {
      await db.execute({ sql: "UPDATE matches SET manual_override=0, manual_status=NULL, manual_home_score=NULL, manual_away_score=NULL WHERE id=?", args: [m] });
    }
    // Drop synthetic live/post matches (pure INSERTs by this test) and any pools on them.
    if (synthIds.length) {
      await db.execute(`DELETE FROM feed_events WHERE match_id IN (${synthIds.map(() => "?").join(",")})`, synthIds as any);
      await db.execute(`DELETE FROM bet_pools WHERE match_id IN (${synthIds.map(() => "?").join(",")})`, synthIds as any);
      await db.execute(`DELETE FROM matches WHERE id IN (${synthIds.map(() => "?").join(",")})`, synthIds as any);
    }
    // Belt + suspenders: remove any synthetic rows by their unmistakable marker.
    await db.execute("DELETE FROM feed_events WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE 'TEST-BETS-%')");
    await db.execute("DELETE FROM bet_pools WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE 'TEST-BETS-%')");
    await db.execute("DELETE FROM matches WHERE espn_event_id LIKE 'TEST-BETS-%'");
    console.log("(cleaned up test pools + match overrides + synthetic matches)");
  }

  console.log(ok ? "\nPASS ✅ bet engine lifecycle sound" : "\nFAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
