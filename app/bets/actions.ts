"use server";

import { revalidatePath } from "next/cache";
import { getCurrentManager } from "@/lib/auth-guard";
import { createPool, takeSpot, cancelPool, editPool, getLedger, type EngineResult } from "@/lib/bets";
import { contribute } from "@/lib/parimutuel";
import { personIdForManager } from "@/lib/people";
import { createSettlement, confirmSettlement, undoSettlement } from "@/lib/settlements";
import type { Outcome } from "@/lib/betting";

function refresh() {
  revalidatePath("/");
  revalidatePath("/bets");
}

export async function createBetAction(input: {
  matchId: number;
  outcome: Outcome;
  buyin: number;
}): Promise<EngineResult> {
  const me = await getCurrentManager();
  if (!me) return { ok: false, error: "Sign in to place a bet." };
  const res = await createPool({
    matchId: input.matchId,
    creatorPersonId: me.personId,
    outcome: input.outcome,
    buyin: input.buyin,
  });
  if (res.ok) refresh();
  return res;
}

export async function takeSpotAction(input: {
  poolId: number;
  outcome: Outcome;
}): Promise<EngineResult> {
  const me = await getCurrentManager();
  if (!me) return { ok: false, error: "Sign in to place a bet." };
  const res = await takeSpot({ poolId: input.poolId, personId: me.personId, outcome: input.outcome });
  if (res.ok) refresh();
  return res;
}

export async function cancelBetAction(input: { poolId: number }): Promise<EngineResult> {
  const me = await getCurrentManager();
  if (!me) return { ok: false, error: "Sign in to manage bets." };
  const res = await cancelPool({ poolId: input.poolId, personId: me.personId });
  if (res.ok) refresh();
  return res;
}

export async function editBetAction(input: { poolId: number; buyin: number }): Promise<EngineResult> {
  const me = await getCurrentManager();
  if (!me) return { ok: false, error: "Sign in to manage bets." };
  const res = await editPool({ poolId: input.poolId, personId: me.personId, buyin: input.buyin });
  if (res.ok) refresh();
  return res;
}

// Pari-mutuel pot: contribute to a match's single pot. Closes at kickoff and
// enforces one-outcome-per-person (top-ups to the same outcome are allowed) in
// the engine; we just relay its {ok,error}.
export async function contributeAction(input: {
  matchId: number;
  outcome: Outcome;
  amount: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentManager();
  if (!me) return { ok: false, error: "Sign in to join the pot." };
  const res = await contribute({
    matchId: input.matchId,
    personId: me.personId,
    outcome: input.outcome,
    amount: input.amount,
  });
  if (res.ok) {
    revalidatePath("/");
    revalidatePath("/bets");
    revalidatePath("/schedule");
  }
  return res;
}

// ---- Settle Up: real-dollar payments -----------------------------------------

type SettleResult = { ok: true } | { ok: false; error: string };

// Log a payment on a debt line. `fromName` owes `toName`; the caller must be one
// of the two. We resolve names -> person ids and set the CALLER's ack
// (createSettlement infers payer vs payee from ackByPersonId).
export async function markPaidAction(input: {
  fromName: string;
  toName: string;
  amount: number;
}): Promise<SettleResult> {
  const me = await getCurrentManager();
  if (!me) return { ok: false, error: "Sign in to settle up." };

  // Cap the payment at the live outstanding for this exact pair. The client
  // gates partials, but a crafted call could otherwise log more than the debt
  // and push the ledger negative — enforce it here against getLedger.
  const ledger = await getLedger();
  const debt = ledger.debts.find((d) => d.from === input.fromName && d.to === input.toName);
  if (!debt) {
    return { ok: false, error: "Nothing outstanding to settle on that line." };
  }
  const amt = Math.round(input.amount);
  if (!(amt >= 1)) {
    return { ok: false, error: "Enter a whole-dollar amount of at least $1." };
  }
  if (amt > debt.amount) {
    return { ok: false, error: `That's more than the $${debt.amount} owed.` };
  }

  const [fromPersonId, toPersonId] = await Promise.all([
    personIdForManager(input.fromName),
    personIdForManager(input.toName),
  ]);
  if (fromPersonId == null || toPersonId == null) {
    return { ok: false, error: "couldn't resolve one of the managers" };
  }
  if (me.personId !== fromPersonId && me.personId !== toPersonId) {
    return { ok: false, error: "only the debtor or creditor can settle this line" };
  }

  const res = await createSettlement({
    fromPersonId,
    toPersonId,
    amount: amt,
    ackByPersonId: me.personId,
  });
  if (res.ok) {
    revalidatePath("/bets");
    revalidatePath("/");
    return { ok: true };
  }
  return res;
}

export async function confirmSettlementAction(id: number): Promise<SettleResult> {
  const me = await getCurrentManager();
  if (!me) return { ok: false, error: "Sign in to settle up." };
  const res = await confirmSettlement(id, me.personId);
  if (res.ok) {
    revalidatePath("/bets");
    revalidatePath("/");
  }
  return res;
}

export async function undoSettlementAction(id: number): Promise<SettleResult> {
  const me = await getCurrentManager();
  if (!me) return { ok: false, error: "Sign in to settle up." };
  const res = await undoSettlement(id, me.personId);
  if (res.ok) {
    revalidatePath("/bets");
    revalidatePath("/");
  }
  return res;
}
