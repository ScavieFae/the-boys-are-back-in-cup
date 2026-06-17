"use server";

import { revalidatePath } from "next/cache";
import { signIn, signOut, isAdmin } from "@/lib/admin-auth";
import { setManualScore, clearManualOverride } from "@/lib/admin";
import { syncFixtures } from "@/lib/sync";
import { voidSettlement, reactivateSettlement } from "@/lib/settlements";

export async function loginAction(formData: FormData) {
  await signIn(String(formData.get("password") ?? ""));
  revalidatePath("/admin");
}

export async function logoutAction() {
  await signOut();
  revalidatePath("/admin");
}

export async function saveScoreAction(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = Number(formData.get("matchId"));
  const homeRaw = formData.get("home");
  const awayRaw = formData.get("away");
  const status = String(formData.get("status") ?? "post");
  const home = homeRaw === "" || homeRaw == null ? null : Number(homeRaw);
  const away = awayRaw === "" || awayRaw == null ? null : Number(awayRaw);
  await setManualScore(id, home, away, status);
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function clearOverrideAction(formData: FormData) {
  if (!(await isAdmin())) return;
  await clearManualOverride(Number(formData.get("matchId")));
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function syncAction() {
  if (!(await isAdmin())) return;
  await syncFixtures();
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function voidSettlementAction(formData: FormData) {
  if (!(await isAdmin())) return;
  await voidSettlement(Number(formData.get("id")));
  revalidatePath("/admin");
  revalidatePath("/bets");
}

export async function reactivateSettlementAction(formData: FormData) {
  if (!(await isAdmin())) return;
  await reactivateSettlement(Number(formData.get("id")));
  revalidatePath("/admin");
  revalidatePath("/bets");
}
