/* eslint-disable @typescript-eslint/no-explicit-any */
import { db, ensureSchema } from "../lib/db";
import {
  createSettlement,
  confirmSettlement,
  undoSettlement,
  voidSettlement,
  getSettlements,
  getAllSettlementsAdmin,
  settlementLedgerTransfers,
} from "../lib/settlements";
import { createPool, takeSpot, settleAllPools, getLedger } from "../lib/bets";

let ok = true;
const check = (c: boolean, label: string) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) ok = false; };

const NOTE = "TEST-SETTLE";

async function main() {
  await ensureSchema();

  const people = (await db.execute("SELECT id, name FROM people")).rows as any[];
  const pid = (n: string) => Number(people.find((p) => p.name === n).id);
  const Mattie = pid("Mattie"), Brian = pid("Brian"), Dereck = pid("Dereck");

  const createdSettlements: number[] = [];
  const createdPools: number[] = [];
  const touchedMatches: number[] = [];

  // Capture the BASELINE ledger before we touch anything. The whole suite must
  // leave getLedger byte-identical to this once settlements are cleaned up.
  const baseline = JSON.stringify(await getLedger());

  try {
    // --- createSettlement ack semantics ------------------------------------
    const byPayer = await createSettlement({ fromPersonId: Brian, toPersonId: Mattie, amount: 10, ackByPersonId: Brian, note: NOTE });
    check(byPayer.ok === true, "createSettlement by payer succeeds");
    if (byPayer.ok) createdSettlements.push(byPayer.id);
    const payerRow = (await db.execute({ sql: "SELECT * FROM settlements WHERE id=?", args: [(byPayer as any).id] })).rows[0] as any;
    check(payerRow.payer_ack_at != null && payerRow.payee_ack_at == null, "payer ack set, payee ack null");
    const payerView = (await getSettlements()).find((s) => s.id === (byPayer as any).id)!;
    check(payerView.ackStatus === "payer_marked", "ackStatus 'payer_marked' when only payer acked");

    const byPayee = await createSettlement({ fromPersonId: Brian, toPersonId: Mattie, amount: 5, ackByPersonId: Mattie, note: NOTE });
    check(byPayee.ok === true, "createSettlement by payee succeeds");
    if (byPayee.ok) createdSettlements.push(byPayee.id);
    const payeeView = (await getSettlements()).find((s) => s.id === (byPayee as any).id)!;
    check(payeeView.ackStatus === "payee_marked", "ackStatus 'payee_marked' when only payee acked");

    const notParty = await createSettlement({ fromPersonId: Brian, toPersonId: Mattie, amount: 5, ackByPersonId: Dereck, note: NOTE });
    check(!notParty.ok && /party/.test((notParty as any).error), "reject createSettlement when ackBy isn't a party");

    const samePerson = await createSettlement({ fromPersonId: Brian, toPersonId: Brian, amount: 5, ackByPersonId: Brian, note: NOTE });
    check(!samePerson.ok && /different/.test((samePerson as any).error), "reject createSettlement payer === payee");

    const badAmount = await createSettlement({ fromPersonId: Brian, toPersonId: Mattie, amount: 0, ackByPersonId: Brian, note: NOTE });
    check(!badAmount.ok && /whole dollar/.test((badAmount as any).error), "reject createSettlement amount < 1");

    // --- confirmSettlement: the OTHER party -> 'paid' ----------------------
    const confirmOk = await confirmSettlement((byPayer as any).id, Mattie); // payee confirms payer-marked
    check(confirmOk.ok === true, "confirmSettlement by the other party succeeds");
    const confirmedView = (await getSettlements()).find((s) => s.id === (byPayer as any).id)!;
    check(confirmedView.ackStatus === "paid", "ackStatus 'paid' after both acks");

    const confirmAgain = await confirmSettlement((byPayer as any).id, Mattie);
    check(!confirmAgain.ok && /already/.test((confirmAgain as any).error), "reject confirm when caller already acked");

    const confirmNonParty = await confirmSettlement((byPayee as any).id, Dereck);
    check(!confirmNonParty.ok && /party/.test((confirmNonParty as any).error), "reject confirm by a non-party");

    // --- undoSettlement: clears caller's ack; sole ack -> voided -----------
    // byPayee currently has ONLY payee_ack (Mattie). Undo by Mattie -> voided.
    const undoSole = await undoSettlement((byPayee as any).id, Mattie);
    check(undoSole.ok === true, "undoSettlement (sole ack) succeeds");
    const undoneRow = (await db.execute({ sql: "SELECT * FROM settlements WHERE id=?", args: [(byPayee as any).id] })).rows[0] as any;
    check(undoneRow.status === "voided" && undoneRow.payee_ack_at == null, "undo of sole ack -> voided, ack cleared");

    // byPayer is 'paid' (both acks). Undo by Brian clears payer_ack -> stays active, payee remains.
    const undoOne = await undoSettlement((byPayer as any).id, Brian);
    check(undoOne.ok === true, "undoSettlement (one of two acks) succeeds");
    const partialRow = (await db.execute({ sql: "SELECT * FROM settlements WHERE id=?", args: [(byPayer as any).id] })).rows[0] as any;
    check(partialRow.status === "active" && partialRow.payer_ack_at == null && partialRow.payee_ack_at != null,
      "undo of one ack -> stays active with remaining ack");

    const undoNonParty = await undoSettlement((byPayer as any).id, Dereck);
    check(!undoNonParty.ok && /party/.test((undoNonParty as any).error), "reject undo by a non-party");

    // --- settlementLedgerTransfers direction -------------------------------
    // byPayer (id) is active: Brian paid Mattie $10. The reverse edge must REDUCE
    // Brian's debt: emit { from: Mattie, to: Brian, amount: 10 }.
    const transfers = await settlementLedgerTransfers();
    const t = transfers.find((x) => x.from === "Mattie" && x.to === "Brian" && x.amount === 10);
    check(t != null, "settlementLedgerTransfers emits reverse edge (Mattie->Brian $10) reducing debtor's debt");

    // void the remaining settlement so the ledger-fold section starts clean.
    await voidSettlement((byPayer as any).id);
    check((await getSettlements()).length === 0 || !(await getSettlements()).some((s) => createdSettlements.includes(s.id)),
      "voidSettlement removes it from active views");

    // --- Ledger fold: known bet-debt offset by a settlement ----------------
    // Build a fresh 3-spot pool, settle it to a home win so Brian & Dereck each
    // owe Mattie their buy-ins. Then settle those debts and assert the outstanding
    // ledger reflects the reduction.
    const m = (await db.execute(
      "SELECT id FROM matches WHERE status='pre' AND odds_home IS NOT NULL LIMIT 1",
    )).rows[0] as any;
    const matchId = Number(m.id);
    touchedMatches.push(matchId);

    const cp = await createPool({ matchId, creatorPersonId: Mattie, outcome: "home", buyin: 20 });
    check(cp.ok === true, "fold: create 3-spot pool (Mattie home $20)");
    const poolId = (cp as any).poolId; createdPools.push(poolId);
    await takeSpot({ poolId, personId: Brian, outcome: "away" });
    await takeSpot({ poolId, personId: Dereck, outcome: "draw" });
    const poolRow = (await db.execute({ sql: "SELECT * FROM bet_pools WHERE id=?", args: [poolId] })).rows[0] as any;
    const awayBuyin = Number(poolRow.buyin_away); // Brian owes Mattie this
    const drawBuyin = Number(poolRow.buyin_draw); // Dereck owes Mattie this

    await db.execute({ sql: "UPDATE matches SET manual_override=1, manual_status='post', manual_home_score=2, manual_away_score=0 WHERE id=?", args: [matchId] });
    await settleAllPools();

    const ledBefore = await getLedger();
    const brianOwesBefore = ledBefore.debts.find((d) => d.from === "Brian" && d.to === "Mattie")?.amount ?? 0;
    const dereckOwesBefore = ledBefore.debts.find((d) => d.from === "Dereck" && d.to === "Mattie")?.amount ?? 0;
    check(brianOwesBefore === awayBuyin, `fold: pre-settlement Brian owes Mattie $${awayBuyin}`);
    check(dereckOwesBefore === drawBuyin, `fold: pre-settlement Dereck owes Mattie $${drawBuyin}`);

    // FULL settlement: Brian pays Mattie the whole away buy-in -> debt zeroed.
    const sFull = await createSettlement({ fromPersonId: Brian, toPersonId: Mattie, amount: awayBuyin, ackByPersonId: Brian, note: NOTE });
    createdSettlements.push((sFull as any).id);
    const ledFull = await getLedger();
    const brianOwesFull = ledFull.debts.find((d) => d.from === "Brian" && d.to === "Mattie");
    check(brianOwesFull == null, "fold: full settlement zeroes Brian's outstanding debt");

    // PARTIAL settlement: Dereck pays Mattie $1 (< draw buy-in) -> reduced by $1.
    const sPartial = await createSettlement({ fromPersonId: Dereck, toPersonId: Mattie, amount: 1, ackByPersonId: Dereck, note: NOTE });
    createdSettlements.push((sPartial as any).id);
    const ledPartial = await getLedger();
    const dereckOwesPartial = ledPartial.debts.find((d) => d.from === "Dereck" && d.to === "Mattie")?.amount ?? 0;
    check(dereckOwesPartial === drawBuyin - 1, `fold: partial settlement reduces Dereck's debt to $${drawBuyin - 1}`);

    // OVER-PAYMENT: Brian over-pays so the pair flips (Mattie now owes Brian back).
    const overpay = awayBuyin + 5;
    const sOver = await createSettlement({ fromPersonId: Brian, toPersonId: Mattie, amount: overpay, ackByPersonId: Brian, note: NOTE });
    createdSettlements.push((sOver as any).id);
    const ledOver = await getLedger();
    // Brian already fully settled once (sFull); now another `overpay` on top means
    // Mattie owes Brian back. Assert the pair flipped to Mattie -> Brian.
    const flipped = ledOver.debts.find((d) => d.from === "Mattie" && d.to === "Brian");
    check(flipped != null && flipped.amount > 0, "fold: over-payment flips the pair (Mattie owes Brian back)");
    check(ledOver.debts.find((d) => d.from === "Brian" && d.to === "Mattie") == null, "fold: flipped pair has no Brian->Mattie debt");
  } finally {
    // Cleanup in FK order. Settlements first (by tracked ids AND marker note),
    // then pools/feed, then match overrides.
    if (createdSettlements.length) {
      const uniq = [...new Set(createdSettlements)];
      await db.execute(`DELETE FROM settlements WHERE id IN (${uniq.map(() => "?").join(",")})`, uniq as any);
    }
    await db.execute({ sql: "DELETE FROM settlements WHERE note = ?", args: [NOTE] });

    if (createdPools.length) {
      const uniq = [...new Set(createdPools)];
      await db.execute(`DELETE FROM feed_events WHERE pool_id IN (${uniq.map(() => "?").join(",")})`, uniq as any);
      await db.execute(`DELETE FROM bet_pools WHERE id IN (${uniq.map(() => "?").join(",")})`, uniq as any);
    }
    for (const mId of touchedMatches) {
      await db.execute({ sql: "UPDATE matches SET manual_override=0, manual_status=NULL, manual_home_score=NULL, manual_away_score=NULL WHERE id=?", args: [mId] });
    }
    console.log("(cleaned up test settlements + pools + match overrides)");
  }

  // --- Ledger byte-identical with zero active settlements -----------------
  const after = JSON.stringify(await getLedger());
  check(after === baseline, "getLedger is byte-identical to baseline once settlements are cleaned up");

  // --- DB clean: no leftover TEST settlements -----------------------------
  const leftover = (await db.execute({ sql: "SELECT COUNT(*) n FROM settlements WHERE note = ?", args: [NOTE] })).rows[0] as any;
  check(Number(leftover.n) === 0, "no leftover TEST settlements in DB");

  // getAllSettlementsAdmin is callable and returns an array (smoke check).
  check(Array.isArray(await getAllSettlementsAdmin()), "getAllSettlementsAdmin returns an array");

  console.log(ok ? "\nPASS ✅ settlements engine + ledger fold sound" : "\nFAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
