"use server";

import { revalidatePath } from "next/cache";
import { getCurrentManager } from "@/lib/auth-guard";
import { setRule, runAutoBets, revertOpenAutoBets, type AutoBetCriteria } from "@/lib/autobet";

const CRITERIA: AutoBetCriteria[] = ["draw", "my_teams", "home", "away", "favorite", "underdog"];

export async function saveAutoBetAction(formData: FormData) {
  const current = await getCurrentManager();
  if (!current) return;

  const criteriaRaw = String(formData.get("criteria") ?? "");
  const criteria = (CRITERIA as string[]).includes(criteriaRaw)
    ? (criteriaRaw as AutoBetCriteria)
    : "draw";

  const stake = Math.max(1, Math.round(Number(formData.get("stake")) || 0));
  const horizonDays = Math.max(1, Math.round(Number(formData.get("horizonDays")) || 0));
  const active = formData.get("active") != null;

  await setRule({ personId: current.personId, criteria, stake, horizonDays, active });

  if (active) {
    await runAutoBets({ personId: current.personId });
  }

  revalidatePath("/bets");
  revalidatePath("/");
}

export async function revertAutoBetAction() {
  const current = await getCurrentManager();
  if (!current) return;

  await revertOpenAutoBets(current.personId);

  revalidatePath("/bets");
  revalidatePath("/");
}
