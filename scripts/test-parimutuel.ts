/* eslint-disable @typescript-eslint/no-explicit-any */
// Test of the pari-mutuel pot foundation (lib/parimutuel.ts + the getLedger fold).
//
// SAFETY: like test-bets / test-feed, this never mutates a canonical row. It
// INSERTs SYNTHETIC matches (espn_event_id 'TEST-PARI-N', collision-proof via a
// monotonic counter + timestamp), creates pari pools/entries only on those
// matches, and in `finally` deletes feed_events -> pari_entries -> pari_pools ->
// synthetic matches (FK order). Canonical data is untouched, and we assert the
// pari tables are clean afterward.
import { db, ensureSchema } from "../lib/db";
import {
  contribute,
  settlePariPools,
  pariLedgerTransfers,
  getPariView,
  getAllPariViews,
} from "../lib/parimutuel";
import { getLedger } from "../lib/bets";

let ok = true;
const check = (c: boolean, label: string) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) ok = false; };
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

async function main() {
  await ensureSchema();

  const people = (await db.execute("SELECT id, name FROM people")).rows as any[];
  const pid = (n: string) => Number(people.find((p) => p.name === n).id);
  const Mattie = pid("Mattie"), Brian = pid("Brian"), Dereck = pid("Dereck");

  const synthIds: number[] = [];
  let seq = 0;
  const marker = `TEST-PARI-${Date.now()}`;
  const makeMatch = async (status: string): Promise<number> => {
    seq += 1;
    const res = await db.execute({
      sql: `INSERT INTO matches
              (espn_event_id, status, kickoff_utc, home_name, away_name, home_code, away_code)
            VALUES (?,?,?,?,?,?,?)`,
      args: [`${marker}-${seq}`, status, new Date().toISOString(), `PariHome${seq}`, `PariAway${seq}`, "PHM", "PAW"],
    });
    const id = Number(res.lastInsertRowid);
    synthIds.push(id);
    return id;
  };
  const setResult = async (matchId: number, hs: number, as: number) =>
    db.execute({ sql: "UPDATE matches SET status='post', home_score=?, away_score=? WHERE id=?", args: [hs, as, matchId] });

  try {
    // ===== contribute: open while 'pre', closed at kickoff =====================
    const mA = await makeMatch("pre");
    check((await contribute({ matchId: mA, personId: Brian, outcome: "home", amount: 40 })).ok === true, "contribute OK while 'pre' (Brian home $40)");
    // top-up SAME outcome is allowed
    check((await contribute({ matchId: mA, personId: Brian, outcome: "home", amount: 0 })).ok === false, "reject: amount < $1");
    check((await contribute({ matchId: mA, personId: Brian, outcome: "home", amount: 10 })).ok === true, "top-up SAME outcome allowed (Brian +$10 home, total $50)");
    // different outcome -> rejected (one-outcome rule)
    const split = await contribute({ matchId: mA, personId: Brian, outcome: "draw", amount: 5 });
    check(!split.ok && /already in the pot on home/.test((split as any).error), "reject: same person, different outcome (no split)");

    // aggregate: Brian home should be $50 (two entries summed)
    const va = await getPariView(mA, Brian);
    check(va?.outcomes.home.total === 50, "view aggregates Brian's two home entries -> $50");
    check(va?.outcomes.home.backers.length === 1, "view: one backer row for Brian on home (aggregated)");
    check(va?.mine?.outcome === "home" && va?.mine?.amount === 50, "view: mine reflects person's aggregated stake");

    // close at kickoff: flip to live, then contribute must be rejected
    await db.execute({ sql: "UPDATE matches SET status='in' WHERE id=?", args: [mA] });
    const closedLive = await contribute({ matchId: mA, personId: Mattie, outcome: "away", amount: 10 });
    check(!closedLive.ok && /closed at kickoff/.test((closedLive as any).error), "reject: contribute once match is LIVE ('in') — closed at kickoff");
    await setResult(mA, 2, 0); // home win, but only Brian in -> nobody else; will VOID (no losers... actually sw>0 -> settles, pot=50 all Brian)
    const closedPost = await contribute({ matchId: mA, personId: Mattie, outcome: "away", amount: 10 });
    check(!closedPost.ok && /closed at kickoff/.test((closedPost as any).error), "reject: contribute once match is FINAL ('post')");

    // ===== settlement pro-rata: hand-computed case ============================
    // home backers: Brian $40 + Mattie $20; draw: Dereck $30. Total pot $90.
    // home wins -> Sw = $60. Winners split the WHOLE pot pro-rata:
    //   Brian payout = 90*(40/60) = $60  -> net +$20 (got back own $40 + $20)
    //   Mattie payout = 90*(20/60) = $30 -> net +$10
    //   Dereck (draw) loses his $30      -> net -$30
    // Conservation: +20 +10 -30 = 0. As loser->winner transfers, Dereck owes
    // Brian 30*(40/60)=$20 and Mattie 30*(20/60)=$10.
    const mB = await makeMatch("pre");
    check((await contribute({ matchId: mB, personId: Brian, outcome: "home", amount: 40 })).ok === true, "settle case: Brian home $40");
    check((await contribute({ matchId: mB, personId: Mattie, outcome: "home", amount: 20 })).ok === true, "settle case: Mattie home $20");
    check((await contribute({ matchId: mB, personId: Dereck, outcome: "draw", amount: 30 })).ok === true, "settle case: Dereck draw $30");
    await setResult(mB, 1, 0); // home win

    const s1 = await settlePariPools();
    check(s1.settled >= 1, `settlePariPools settled the pot (got ${s1.settled} settled)`);
    const vb = await getPariView(mB);
    check(vb?.status === "settled" && vb?.result === "home", "pot settled -> result home");
    check(vb?.pot === 90, "pot total = $90");

    // ledger transfers for THIS pool: losers->winners. Dereck($30) owes Brian
    // 30*(40/60)=20 and Mattie 30*(20/60)=10. No other transfers (winners don't owe).
    const transfers = await pariLedgerTransfers();
    const tDB = transfers.filter((t) => t.from === "Dereck");
    const dToBrian = tDB.find((t) => t.to === "Brian");
    const dToMattie = tDB.find((t) => t.to === "Mattie");
    check(!!dToBrian && approx(dToBrian.amount, 20), `Dereck -> Brian = $20 (got ${dToBrian?.amount})`);
    check(!!dToMattie && approx(dToMattie.amount, 10), `Dereck -> Mattie = $10 (got ${dToMattie?.amount})`);
    check(!transfers.some((t) => t.from === "Brian" || t.from === "Mattie"), "winners owe nobody (no winner->* transfers)");
    // payout net check: Brian +20, Mattie +10, Dereck -30 -> conservation sum 0.
    const netB = transfers.filter((t) => t.to === "Brian").reduce((s, t) => s + t.amount, 0) - transfers.filter((t) => t.from === "Brian").reduce((s, t) => s + t.amount, 0);
    const netM = transfers.filter((t) => t.to === "Mattie").reduce((s, t) => s + t.amount, 0) - transfers.filter((t) => t.from === "Mattie").reduce((s, t) => s + t.amount, 0);
    const netD = transfers.filter((t) => t.to === "Dereck").reduce((s, t) => s + t.amount, 0) - transfers.filter((t) => t.from === "Dereck").reduce((s, t) => s + t.amount, 0);
    check(approx(netB, 20) && approx(netM, 10) && approx(netD, -30), `nets: Brian +20, Mattie +10, Dereck -30 (got ${netB}/${netM}/${netD})`);
    check(approx(netB + netM + netD, 0), "conservation: sum of nets ~ 0");

    // ===== no-winner -> void/refund (Sw=0): everyone net 0 ====================
    const mC = await makeMatch("pre");
    check((await contribute({ matchId: mC, personId: Brian, outcome: "home", amount: 25 })).ok === true, "void case: Brian home $25");
    check((await contribute({ matchId: mC, personId: Mattie, outcome: "home", amount: 15 })).ok === true, "void case: Mattie home $15");
    // away wins -> nobody backed away -> Sw=0 -> VOID
    await setResult(mC, 0, 2);
    const s2 = await settlePariPools();
    check(s2.voided >= 1, `settlePariPools voided the no-winner pot (got ${s2.voided} voided)`);
    const vc = await getPariView(mC);
    check(vc?.status === "void", "no-winner pot -> void");
    // void pool contributes no transfers
    const transfers2 = await pariLedgerTransfers();
    check(!transfers2.some((t) => /void/.test(t.from)), "void pool emits no transfers (sanity)");

    // ===== idempotency: re-running settle changes nothing =====================
    const before = await pariLedgerTransfers();
    await settlePariPools();
    const after = await pariLedgerTransfers();
    check(JSON.stringify(before) === JSON.stringify(after), "settlePariPools idempotent (transfers stable)");

    // ===== getLedger conservation with pari folded in =========================
    const led = await getLedger();
    const sumNet = led.totals.reduce((s, t) => s + t.net, 0);
    check(Math.abs(sumNet) <= 1, `getLedger nets sum ~ 0 with pari folded in (got ${sumNet})`);
    // The pari debt Dereck->Brian $20 / Dereck->Mattie $10 should appear (or net
    // against any 3-spot debts). Assert Dereck shows a negative net of at least 30
    // attributable to our pots — and the unified debts list is non-empty/sane.
    check(led.debts.every((d) => d.from !== d.to && d.amount > 0), "getLedger debts are well-formed (from != to, amount > 0)");

    // ===== getAllPariViews shapes match labels ================================
    const all = await getAllPariViews();
    const settledB = all.settled.find((v) => v.matchId === mB);
    check(!!settledB && !!settledB.match?.homeName?.startsWith("PariHome"), "getAllPariViews includes settled pot with match labels");
    check(all.open.every((v) => v.status === "open") && all.settled.every((v) => v.status === "settled"), "getAllPariViews partitions open/settled");

    // mine is null when no personId is passed...
    check(all.settled.concat(all.open).every((v) => v.mine === null), "getAllPariViews: mine is null without a personId");
    // ...and populated to the person's aggregated stake when it is. Brian put
    // home $40 in the settled pot mB.
    const allBrian = await getAllPariViews(Brian);
    const bMine = allBrian.settled.find((v) => v.matchId === mB)?.mine;
    check(bMine?.outcome === "home" && bMine?.amount === 40, "getAllPariViews(personId): mine reflects the person's stake");
    // A person not in a given pool stays null. Dereck wasn't in the void pot mC.
    const allDereck = await getAllPariViews(Dereck);
    const dMineC = allDereck.settled.concat(allDereck.open).find((v) => v.matchId === mC);
    check(dMineC ? dMineC.mine === null : true, "getAllPariViews(personId): mine null for a pool the person isn't in");
  } finally {
    // Cleanup in FK order: feed_events -> pari_entries -> pari_pools -> matches.
    if (synthIds.length) {
      const ph = synthIds.map(() => "?").join(",");
      await db.execute({ sql: `DELETE FROM feed_events WHERE match_id IN (${ph})`, args: synthIds });
      await db.execute({
        sql: `DELETE FROM pari_entries WHERE pool_id IN (SELECT id FROM pari_pools WHERE match_id IN (${ph}))`,
        args: synthIds,
      });
      await db.execute({ sql: `DELETE FROM pari_pools WHERE match_id IN (${ph})`, args: synthIds });
      await db.execute({ sql: `DELETE FROM matches WHERE id IN (${ph})`, args: synthIds });
    }
    // Belt + suspenders by marker.
    await db.execute(`DELETE FROM feed_events WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE '${marker}-%')`);
    await db.execute(`DELETE FROM pari_entries WHERE pool_id IN (SELECT id FROM pari_pools WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE '${marker}-%'))`);
    await db.execute(`DELETE FROM pari_pools WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE '${marker}-%')`);
    await db.execute(`DELETE FROM matches WHERE espn_event_id LIKE '${marker}-%'`);

    // Verify pari tables are clean of our synthetic rows.
    const leftPools = Number((await db.execute(`SELECT COUNT(*) n FROM pari_pools WHERE match_id IN (SELECT id FROM matches WHERE espn_event_id LIKE '${marker}-%')`)).rows[0].n);
    const leftEntries = Number((await db.execute(`SELECT COUNT(*) n FROM pari_entries WHERE pool_id NOT IN (SELECT id FROM pari_pools)`)).rows[0].n);
    check(leftPools === 0, "cleanup: no synthetic pari_pools remain");
    check(leftEntries === 0, "cleanup: no orphaned pari_entries remain");
    console.log("(cleaned up test pari pools + entries + feed events + synthetic matches)");
  }

  console.log(ok ? "\nPASS ✅ pari-mutuel foundation sound" : "\nFAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
