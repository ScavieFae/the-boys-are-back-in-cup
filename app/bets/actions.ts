"use server";

import { revalidatePath } from "next/cache";
import { getCurrentManager } from "@/lib/auth-guard";
import { createPool, takeSpot, cancelPool, type EngineResult } from "@/lib/bets";
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
