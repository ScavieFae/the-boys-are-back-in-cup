"use server";

import { revalidatePath } from "next/cache";
import { getCurrentManager } from "@/lib/auth-guard";
import {
  getRule,
  setRule,
  runAutoBets,
  revertOpenAutoBets,
  previewAutoBets,
  type AutoBetCriteria,
  type PreviewItem,
} from "@/lib/autobet";

const CRITERIA: AutoBetCriteria[] = ["draw", "my_teams", "home", "away", "favorite", "underdog"];

export interface RuleInput {
  criteria: string;
  stake: number;
  horizonDays: number;
}

function normalize(input: RuleInput) {
  const criteria = (CRITERIA as string[]).includes(input.criteria)
    ? (input.criteria as AutoBetCriteria)
    : "draw";
  const stake = Math.max(1, Math.round(Number(input.stake) || 0));
  const horizonDays = Math.max(1, Math.round(Number(input.horizonDays) || 0));
  return { criteria, stake, horizonDays };
}

function refresh() {
  revalidatePath("/bets");
  revalidatePath("/");
}

// Save settings without changing on/off. Re-runs if currently active so edits apply.
export async function saveAutoBetAction(input: RuleInput) {
  const me = await getCurrentManager();
  if (!me) return;
  const settings = normalize(input);
  const existing = await getRule(me.personId);
  const active = existing?.active ?? false;
  await setRule({ personId: me.personId, ...settings, active });
  if (active) await runAutoBets({ personId: me.personId });
  refresh();
}

// Turn it on AND place once immediately (no waiting for the cron).
export async function activateAutoBetAction(input: RuleInput) {
  const me = await getCurrentManager();
  if (!me) return;
  const settings = normalize(input);
  await setRule({ personId: me.personId, ...settings, active: true });
  await runAutoBets({ personId: me.personId });
  refresh();
}

// Turn it off (settings preserved; open bets stay until cancelled separately).
export async function deactivateAutoBetAction(input: RuleInput) {
  const me = await getCurrentManager();
  if (!me) return;
  const settings = normalize(input);
  await setRule({ personId: me.personId, ...settings, active: false });
  refresh();
}

// Force a placement run now (active rules only; idempotent).
export async function runNowAction() {
  const me = await getCurrentManager();
  if (!me) return;
  await runAutoBets({ personId: me.personId });
  refresh();
}

export async function revertAutoBetAction() {
  const me = await getCurrentManager();
  if (!me) return;
  await revertOpenAutoBets(me.personId);
  refresh();
}

// Dry run of arbitrary (unsaved) settings — powers the Preview button + the
// activate confirmation modal. No writes.
export async function previewAutoBetAction(input: RuleInput): Promise<PreviewItem[]> {
  const me = await getCurrentManager();
  if (!me) return [];
  const settings = normalize(input);
  return previewAutoBets(me.personId, undefined, settings);
}
