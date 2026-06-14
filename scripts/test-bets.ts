/* eslint-disable @typescript-eslint/no-explicit-any */
import { db, ensureSchema } from "../lib/db";
import { createPool, takeSpot, cancelPool, settleAllPools, getLedger } from "../lib/bets";

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
  } finally {
    // cleanup: drop test pools, clear forced overrides
    if (createdPools.length) {
      await db.execute(`DELETE FROM bet_pools WHERE id IN (${createdPools.map(() => "?").join(",")})`, createdPools as any);
    }
    for (const m of touchedMatches) {
      await db.execute({ sql: "UPDATE matches SET manual_override=0, manual_status=NULL, manual_home_score=NULL, manual_away_score=NULL WHERE id=?", args: [m] });
    }
    console.log("(cleaned up test pools + match overrides)");
  }

  console.log(ok ? "\nPASS ✅ bet engine lifecycle sound" : "\nFAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
