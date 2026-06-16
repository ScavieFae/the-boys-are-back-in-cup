/* eslint-disable @typescript-eslint/no-explicit-any */
// Thorough test of the auto-bet engine.
//
// SAFETY: this test never mutates a single canonical `matches` row. It INSERTs
// dedicated SYNTHETIC match rows (espn_event_id 'TEST-AUTOBET-N') with exactly
// the status/kickoff/odds/team_ids each case needs, scopes every engine call to
// those synthetic ids (runAutoBets/previewAutoBets accept a matchIds filter), and
// DELETEs the synthetic matches + any pools/placements/rules it made in `finally`.
// Because the synthetic rows are created by this test and removed by it — and the
// engine is scoped away from real games — the canonical `matches` table is left
// byte-identical to how it started, even if `finally` is reached after a failure.
import { db, ensureSchema } from "../lib/db";
import {
  setRule,
  getRule,
  runAutoBets,
  previewAutoBets,
  getPlacements,
  revertOpenAutoBets,
} from "../lib/autobet";
import { createPool, takeSpot } from "../lib/bets";

let ok = true;
const check = (c: boolean, label: string) => {
  console.log(`${c ? "✓" : "✗"} ${label}`);
  if (!c) ok = false;
};

// Bare-Z minute kickoff offsets from "now" (matches stored kickoff_utc format).
const bareZ = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const soon = (hoursFromNow: number) => bareZ(Date.now() + hoursFromNow * 3600 * 1000);

async function main() {
  await ensureSchema();

  const people = (await db.execute("SELECT id, name FROM people")).rows as any[];
  const pid = (n: string) => Number(people.find((p) => p.name === n).id);
  const Brian = pid("Brian"); // id 1
  const Nathan = pid("Nathan"); // id 2
  const Dan = pid("Dan"); // id 3
  const Mattie = pid("Mattie"); // id 4
  const Dereck = pid("Dereck"); // id 5

  const teams = (await db.execute("SELECT id, owner_id FROM teams WHERE owner_id IS NOT NULL")).rows as any[];
  const teamOf = (owner: number) => Number(teams.find((t) => Number(t.owner_id) === owner).id);
  const freeTeam = Number((await db.execute("SELECT id FROM teams WHERE owner_id IS NULL LIMIT 1")).rows[0]!.id);

  const usedPeople = [Brian, Nathan, Dan, Mattie, Dereck];
  const synthIds: number[] = []; // every synthetic match id we insert
  const createdPools: number[] = [];
  let seq = 0;

  // Insert a synthetic match; returns its id. Pure INSERT — never touches real rows.
  const makeMatch = async (f: {
    status?: string;
    kickoff_utc: string;
    odds_home?: string | null;
    odds_draw?: string | null;
    odds_away?: string | null;
    home_team_id?: number | null;
    away_team_id?: number | null;
  }): Promise<number> => {
    seq += 1;
    const res = await db.execute({
      sql: `INSERT INTO matches
              (espn_event_id, status, kickoff_utc, odds_home, odds_draw, odds_away,
               home_team_id, away_team_id, home_name, away_name)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        `TEST-AUTOBET-${seq}`,
        f.status ?? "pre",
        f.kickoff_utc,
        f.odds_home ?? null,
        f.odds_draw ?? null,
        f.odds_away ?? null,
        f.home_team_id ?? null,
        f.away_team_id ?? null,
        `TestHome${seq}`,
        `TestAway${seq}`,
      ],
    });
    const id = Number(res.lastInsertRowid);
    synthIds.push(id);
    return id;
  };

  const trackPool = (res: any) => {
    if (res?.ok && res.poolId) createdPools.push(res.poolId);
    return res;
  };
  const poolsOnMatch = async (id: number) =>
    (await db.execute({ sql: "SELECT * FROM bet_pools WHERE match_id=?", args: [id] })).rows as any[];
  const trackPoolsOn = async (id: number) => {
    for (const p of await poolsOnMatch(id)) createdPools.push(Number(p.id));
  };
  // Scope an engine run/preview to ONLY our synthetic matches.
  const run = (personId: number, ids: number[]) => runAutoBets({ personId, matchIds: ids });
  const runAll = (ids: number[]) => runAutoBets({ matchIds: ids });
  const preview = (personId: number, ids: number[]) => previewAutoBets(personId, ids);

  try {
    // Clean slate: drop any leftover test rows from a prior interrupted run.
    await db.execute(`DELETE FROM auto_bet_placements WHERE person_id IN (${usedPeople.map(() => "?").join(",")})`, usedPeople as any);
    await db.execute(`DELETE FROM auto_bet_rules WHERE person_id IN (${usedPeople.map(() => "?").join(",")})`, usedPeople as any);
    await db.execute("DELETE FROM bet_pools WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE 'TEST-AUTOBET-%')");
    await db.execute("DELETE FROM matches WHERE espn_event_id LIKE 'TEST-AUTOBET-%'");

    // =====================================================================
    // TEST 1: 'draw' opens a draw pool on an eligible match; skips a post match,
    // a no-odds match, and an out-of-horizon match.
    // =====================================================================
    const M_DRAW = await makeMatch({ status: "pre", kickoff_utc: soon(10), odds_home: "-200", odds_draw: "+300", odds_away: "+500", home_team_id: teamOf(Brian), away_team_id: freeTeam });
    const M_POST = await makeMatch({ status: "post", kickoff_utc: soon(10), odds_home: "-200", odds_draw: "+300", odds_away: "+500", home_team_id: freeTeam, away_team_id: freeTeam });
    const M_NOODDS = await makeMatch({ status: "pre", kickoff_utc: soon(10), odds_home: null, odds_draw: null, odds_away: null });
    const M_FAR = await makeMatch({ status: "pre", kickoff_utc: soon(24 * 10), odds_home: "-200", odds_draw: "+300", odds_away: "+500", home_team_id: freeTeam, away_team_id: freeTeam });
    const t1scope = [M_DRAW, M_POST, M_NOODDS, M_FAR];

    await setRule({ personId: Mattie, criteria: "draw", stake: 50, horizonDays: 2 });
    check((await getRule(Mattie))?.criteria === "draw", "getRule returns the saved 'draw' rule");

    const prev = await preview(Mattie, t1scope);
    const prevDraw = prev.find((p) => p.matchId === M_DRAW);
    check(!!prevDraw && prevDraw.outcome === "draw" && prevDraw.action === "open", "preview: draw rule -> OPEN draw on eligible match");
    check(!prev.some((p) => p.matchId === M_POST), "preview skips the 'post' match");
    check(!prev.some((p) => p.matchId === M_NOODDS), "preview skips the no-odds match");
    check(!prev.some((p) => p.matchId === M_FAR), "preview skips the out-of-horizon match");

    const r1 = await run(Mattie, t1scope);
    await trackPoolsOn(M_DRAW);
    check(r1.opened === 1 && r1.joined === 0, `run: opened exactly the one eligible draw pool (opened=${r1.opened}, joined=${r1.joined})`);
    const drawPool = (await poolsOnMatch(M_DRAW)).find((p) => Number(p.draw_person_id) === Mattie);
    check(!!drawPool, "draw pool exists with Mattie on the draw spot");
    check(!!drawPool && Number(drawPool.buyin_draw) === 50, "Mattie's opened draw buy-in equals her stake ($50)");
    check((await poolsOnMatch(M_POST)).length === 0, "no pool created on the post match");
    check((await poolsOnMatch(M_NOODDS)).length === 0, "no pool created on the no-odds match");
    check((await poolsOnMatch(M_FAR)).length === 0, "no pool created on the out-of-horizon match");

    // =====================================================================
    // TEST 1b: HORIZON BOUNDARY. A match kicking off EXACTLY at the +2d edge is
    // INCLUDED; one a minute past the edge is EXCLUDED.
    // =====================================================================
    const edgeMs = Date.now() + 2 * 24 * 3600 * 1000;
    const M_EDGE = await makeMatch({ status: "pre", kickoff_utc: bareZ(edgeMs), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: freeTeam, away_team_id: freeTeam });
    const M_PAST_EDGE = await makeMatch({ status: "pre", kickoff_utc: bareZ(edgeMs + 60 * 1000), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: freeTeam, away_team_id: freeTeam });
    await setRule({ personId: Dereck, criteria: "draw", stake: 50, horizonDays: 2 });
    const edgePrev = await preview(Dereck, [M_EDGE, M_PAST_EDGE]);
    check(edgePrev.some((p) => p.matchId === M_EDGE), "horizon edge: a kickoff EXACTLY at +2d is included");
    check(!edgePrev.some((p) => p.matchId === M_PAST_EDGE), "horizon edge: a kickoff one minute past +2d is excluded");

    // =====================================================================
    // TEST 2: 'my_teams' bets the owned side; skips neither-owned; skips owns-both.
    // =====================================================================
    const M_MYTEAM = await makeMatch({ status: "pre", kickoff_utc: soon(14), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: teamOf(Dereck), away_team_id: freeTeam });
    const M_BOTH = await makeMatch({ status: "pre", kickoff_utc: soon(16), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: teamOf(Dan), away_team_id: teamOf(Dan) });
    // M_DRAW: home is Brian's team, away is free -> Dereck owns NEITHER.
    await setRule({ personId: Dereck, criteria: "my_teams", stake: 60, horizonDays: 2 });
    const prevDereck = await preview(Dereck, [M_MYTEAM, M_BOTH, M_DRAW]);
    const myTeamItem = prevDereck.find((p) => p.matchId === M_MYTEAM);
    check(!!myTeamItem && myTeamItem.outcome === "home", "my_teams: bets the owned (home) side");
    check(!prevDereck.some((p) => p.matchId === M_BOTH), "my_teams: skips match where person owns BOTH teams");
    check(!prevDereck.some((p) => p.matchId === M_DRAW), "my_teams: skips match where person owns NEITHER team");

    // =====================================================================
    // TEST 3: favorite picks the shorter-odds side; underdog the longer-odds side.
    // =====================================================================
    const M_FAV = await makeMatch({ status: "pre", kickoff_utc: soon(12), odds_home: "-2000", odds_draw: "+1200", odds_away: "+2500", home_team_id: freeTeam, away_team_id: freeTeam });
    await setRule({ personId: Brian, criteria: "favorite", stake: 80, horizonDays: 2 });
    const favItem = (await preview(Brian, [M_FAV])).find((p) => p.matchId === M_FAV);
    check(!!favItem && favItem.outcome === "home", "favorite: picks the shorter-odds (home) side");
    await setRule({ personId: Brian, criteria: "underdog", stake: 80, horizonDays: 2 });
    const dogItem = (await preview(Brian, [M_FAV])).find((p) => p.matchId === M_FAV);
    check(!!dogItem && dogItem.outcome === "away", "underdog: picks the longer-odds (away) side");

    // =====================================================================
    // TEST 4: JOIN-OR-OPEN. Pre-existing pool with target spot open + affordable
    // is JOINED; otherwise a new pool is OPENED.
    // =====================================================================
    const M_JOIN = await makeMatch({ status: "pre", kickoff_utc: soon(15), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: freeTeam, away_team_id: freeTeam });
    const seed = trackPool(await createPool({ matchId: M_JOIN, creatorPersonId: Dan, outcome: "home", buyin: 30 }));
    const seedPool = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [seed.poolId] })).rows[0] as any;
    const drawBuyin = Number(seedPool.buyin_draw);
    await setRule({ personId: Nathan, criteria: "draw", stake: drawBuyin + 100, horizonDays: 2 }); // affordable
    const joinPrev = (await preview(Nathan, [M_JOIN])).filter((p) => p.matchId === M_JOIN);
    check(joinPrev.length === 1 && joinPrev[0].action === "join" && joinPrev[0].amount === drawBuyin, `preview: JOIN existing pool's draw spot at its buy-in ($${drawBuyin})`);
    const rJoin = await run(Nathan, [M_JOIN]);
    await trackPoolsOn(M_JOIN);
    const afterJoin = await poolsOnMatch(M_JOIN);
    check(afterJoin.length === 1 && Number(afterJoin[0].draw_person_id) === Nathan, "JOIN: Nathan took the open draw spot, NO new pool created");
    check(rJoin.joined === 1 && rJoin.opened === 0, `run reports a join (joined=${rJoin.joined}, opened=${rJoin.opened})`);

    // =====================================================================
    // TEST 5: CAN'T-AFFORD-JOIN (single slot costs more than budget) -> never
    // split; open own pool instead.
    // =====================================================================
    const M_POOR = await makeMatch({ status: "pre", kickoff_utc: soon(17), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: freeTeam, away_team_id: freeTeam });
    const seed2 = trackPool(await createPool({ matchId: M_POOR, creatorPersonId: Dan, outcome: "home", buyin: 30 }));
    const seed2Pool = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [seed2.poolId] })).rows[0] as any;
    const drawBuyin2 = Number(seed2Pool.buyin_draw);
    await setRule({ personId: Dereck, criteria: "draw", stake: Math.max(1, drawBuyin2 - 1), horizonDays: 2 }); // can't afford the slot
    const poorPrev = (await preview(Dereck, [M_POOR])).filter((p) => p.matchId === M_POOR);
    check(poorPrev.length === 1 && poorPrev[0].action === "open", "can't-afford-join: preview OPENS own pool instead of joining");
    await run(Dereck, [M_POOR]);
    await trackPoolsOn(M_POOR);
    const afterPoor = await poolsOnMatch(M_POOR);
    check(afterPoor.length === 2, "can't-afford-join: a second (own) pool was opened");
    check(afterPoor.some((p) => Number(p.draw_person_id) === Dereck && Number(p.created_by) === Dereck), "can't-afford-join: Dereck created his own draw pool");

    // =====================================================================
    // TEST 5b: MULTI-JOIN. Two open pools each with the target (draw) spot open
    // + affordable within budget -> the rule joins BOTH; no new pool opened.
    // =====================================================================
    const M_MULTI = await makeMatch({ status: "pre", kickoff_utc: soon(11), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: freeTeam, away_team_id: freeTeam });
    const mA = trackPool(await createPool({ matchId: M_MULTI, creatorPersonId: Dan, outcome: "home", buyin: 30 }));
    const mB = trackPool(await createPool({ matchId: M_MULTI, creatorPersonId: Dan, outcome: "away", buyin: 30 }));
    const mAPool = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [mA.poolId] })).rows[0] as any;
    const mBPool = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [mB.poolId] })).rows[0] as any;
    const drawA = Number(mAPool.buyin_draw);
    const drawB = Number(mBPool.buyin_draw);
    await setRule({ personId: Mattie, criteria: "draw", stake: drawA + drawB + 5, horizonDays: 2 }); // covers both
    const multiPrev = (await preview(Mattie, [M_MULTI])).filter((p) => p.matchId === M_MULTI);
    check(multiPrev.length === 2 && multiPrev.every((p) => p.action === "join"), `multi-join: preview shows TWO joins (got ${multiPrev.length})`);
    const rMulti = await run(Mattie, [M_MULTI]);
    await trackPoolsOn(M_MULTI);
    const multiPools = await poolsOnMatch(M_MULTI);
    check(multiPools.length === 2, "multi-join: NO new pool opened (still two pools)");
    check(multiPools.filter((p) => Number(p.draw_person_id) === Mattie).length === 2, "multi-join: Mattie joined BOTH draw spots");
    check(rMulti.joined === 2 && rMulti.opened === 0, `multi-join: run reports 2 joins, 0 opens (joined=${rMulti.joined}, opened=${rMulti.opened})`);
    check((await getPlacements(Mattie)).filter((p) => p.matchId === M_MULTI).length === 2, "multi-join: two 'join' placement rows recorded");

    // =====================================================================
    // TEST 5c: BUDGET CAP. Two open draw slots; budget covers ONE but not a
    // second -> joins one, skips the second, does NOT open an extra pool.
    // =====================================================================
    const M_CAP = await makeMatch({ status: "pre", kickoff_utc: soon(13), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: freeTeam, away_team_id: freeTeam });
    const cA = trackPool(await createPool({ matchId: M_CAP, creatorPersonId: Dan, outcome: "home", buyin: 30 }));
    trackPool(await createPool({ matchId: M_CAP, creatorPersonId: Dan, outcome: "away", buyin: 30 }));
    const cAPool = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [cA.poolId] })).rows[0] as any;
    const capDraw = Number(cAPool.buyin_draw);
    // Budget: enough for one draw slot, one short of a second.
    await setRule({ personId: Dereck, criteria: "draw", stake: capDraw + (capDraw - 1), horizonDays: 2 });
    const capPrev = (await preview(Dereck, [M_CAP])).filter((p) => p.matchId === M_CAP);
    check(capPrev.length === 1 && capPrev[0].action === "join", `budget-cap: preview shows exactly ONE join (got ${capPrev.length})`);
    const rCap = await run(Dereck, [M_CAP]);
    await trackPoolsOn(M_CAP);
    const capPools = await poolsOnMatch(M_CAP);
    check(capPools.length === 2, "budget-cap: NO extra pool opened (still two pools)");
    check(capPools.filter((p) => Number(p.draw_person_id) === Dereck).length === 1, "budget-cap: Dereck joined exactly ONE draw spot");
    check(rCap.joined === 1 && rCap.opened === 0, `budget-cap: run reports 1 join, 0 opens (joined=${rCap.joined}, opened=${rCap.opened})`);

    // =====================================================================
    // TEST 6: NO DOUBLE-BET. Idempotent re-run; manual-spot-holder skipped;
    // (person,pool) uniqueness; handled-match gating.
    // =====================================================================
    const before = await getPlacements(Mattie);
    const r2 = await run(Mattie, [M_DRAW, M_MULTI]); // matches Mattie already handled
    const after = await getPlacements(Mattie);
    check(r2.placed === 0 && after.length === before.length, "idempotent: re-run on already-handled matches places nothing new");

    // Manual holder skip: Dan holds spots on M_JOIN and M_POOR. His draw rule must
    // not place there.
    await setRule({ personId: Dan, criteria: "draw", stake: 500, horizonDays: 2 });
    const danPrev = await preview(Dan, [M_JOIN, M_POOR]);
    check(!danPrev.some((p) => p.matchId === M_JOIN), "manual holder skipped: Dan already holds a spot on M_JOIN");
    check(!danPrev.some((p) => p.matchId === M_POOR), "manual holder skipped: Dan already holds a spot on M_POOR");

    // Uniqueness: a duplicate (person, pool) placement insert must throw.
    let uniqThrew = false;
    const existing = before.find((p) => p.poolId != null)!;
    try {
      await db.execute({
        sql: "INSERT INTO auto_bet_placements (person_id, match_id, pool_id, outcome, action, placed_at) VALUES (?,?,?,?,?,?)",
        args: [Mattie, existing.matchId, existing.poolId, "draw", "open", new Date().toISOString()],
      });
    } catch {
      uniqThrew = true;
    }
    check(uniqThrew, "UNIQUE(person_id, pool_id) blocks a duplicate placement");

    // =====================================================================
    // TEST 7: DETERMINISM. Two rules land in the SAME pool on DIFFERENT spots.
    // The lower person_id runs first and OPENS; the higher then JOINS that pool's
    // open target spot. person_id ASC ordering makes this resolve identically
    // every run.
    // =====================================================================
    const M_COLLIDE = await makeMatch({ status: "pre", kickoff_utc: soon(22), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: freeTeam, away_team_id: freeTeam });
    // Silence other people's draw rules from earlier tests so only Brian+Mattie fire.
    await db.execute(`UPDATE auto_bet_rules SET active=0 WHERE person_id IN (${usedPeople.map(() => "?").join(",")})`, usedPeople as any);
    await setRule({ personId: Brian, criteria: "home", stake: 40, horizonDays: 2 });
    await setRule({ personId: Mattie, criteria: "draw", stake: 500, horizonDays: 2 });
    await runAll([M_COLLIDE]); // ALL (active) rules, scoped to this match, person_id order
    await trackPoolsOn(M_COLLIDE);
    const collisionPools = await poolsOnMatch(M_COLLIDE);
    check(collisionPools.length === 1, "determinism: exactly ONE pool (opener + joiner share it)");
    const cp = collisionPools[0];
    check(!!cp && Number(cp.created_by) === Brian, "determinism: lower person_id (Brian) OPENED the pool");
    check(!!cp && Number(cp.home_person_id) === Brian, "determinism: Brian holds the home spot he opened");
    check(!!cp && Number(cp.draw_person_id) === Mattie, "determinism: higher person_id (Mattie) JOINED the same pool's draw spot");
    const mattieHere = (await getPlacements(Mattie)).find((p) => p.matchId === M_COLLIDE);
    check(!!mattieHere && mattieHere.action === "join", "determinism: Mattie's placement on this match is a JOIN");

    // =====================================================================
    // TEST 8: revertOpenAutoBets cancels a still-open opened pool, leaves a
    // joined (2-spot) one.
    // =====================================================================
    // M_DRAW: Mattie OPENED a 1-spot draw pool (test 1) -> cancelable.
    // M_LOCK: Mattie opens a pool, Nathan joins it -> 2 spots -> locked -> left alone.
    const M_LOCK = await makeMatch({ status: "pre", kickoff_utc: soon(24), odds_home: "-150", odds_draw: "+275", odds_away: "+400", home_team_id: freeTeam, away_team_id: freeTeam });
    await setRule({ personId: Mattie, criteria: "draw", stake: 500, horizonDays: 2 });
    await run(Mattie, [M_LOCK]);
    await trackPoolsOn(M_LOCK);
    const lockPool = (await poolsOnMatch(M_LOCK)).find((p) => Number(p.draw_person_id) === Mattie)!;
    await takeSpot({ poolId: Number(lockPool.id), personId: Nathan, outcome: "home" }); // 2 spots -> locked

    const placementsBefore = await getPlacements(Mattie);
    const openCount = placementsBefore.filter((p) => p.action === "open").length;
    const rev = await revertOpenAutoBets(Mattie);
    check(rev.reverted >= 1, `revert: cancelled at least one still-open opened pool (reverted=${rev.reverted})`);

    const drawAfter = (await poolsOnMatch(M_DRAW)).find((p) => Number(p.created_by) === Mattie);
    check(!!drawAfter && drawAfter.status === "void", "revert: Mattie's still-open M_DRAW pool was cancelled (void)");
    const lockAfter = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [Number(lockPool.id)] })).rows[0] as any;
    check(lockAfter.status === "open" && Number(lockAfter.home_person_id) === Nathan, "revert: the joined (2-spot) pool was LEFT intact");
    const placementsAfter = await getPlacements(Mattie);
    check(placementsAfter.length === placementsBefore.length - rev.reverted, "revert: only reverted placement rows were deleted");
    check(rev.reverted <= openCount, "revert: never reverts more than the open placements");
  } finally {
    // Cleanup: placements first (FK-reference bet_pools.pool_id), then pools, then
    // rules, then the synthetic matches. Nothing canonical is touched.
    await db.execute(`DELETE FROM auto_bet_placements WHERE person_id IN (${usedPeople.map(() => "?").join(",")})`, usedPeople as any);
    await db.execute(`DELETE FROM auto_bet_rules WHERE person_id IN (${usedPeople.map(() => "?").join(",")})`, usedPeople as any);
    if (synthIds.length) {
      await db.execute(`DELETE FROM bet_pools WHERE match_id IN (${synthIds.map(() => "?").join(",")})`, synthIds as any);
    }
    if (createdPools.length) {
      const uniq = [...new Set(createdPools)];
      await db.execute(`DELETE FROM bet_pools WHERE id IN (${uniq.map(() => "?").join(",")})`, uniq as any);
    }
    // Belt + suspenders: remove any synthetic rows by their unmistakable marker.
    await db.execute("DELETE FROM bet_pools WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE 'TEST-AUTOBET-%')");
    await db.execute("DELETE FROM matches WHERE espn_event_id LIKE 'TEST-AUTOBET-%'");
    console.log("(cleaned up synthetic matches, rules, placements, and pools)");
  }

  console.log(ok ? "\nPASS ✅ auto-bet engine sound" : "\nFAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
