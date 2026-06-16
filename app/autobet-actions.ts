"use server";

import { revalidatePath } from "next/cache";
import { getCurrentManager } from "@/lib/auth-guard";
import {
  getRuleById,
  createRule,
  updateRule,
  setRuleActive,
  deleteRule,
  moveRule,
  runAutoBets,
  revertOpenAutoBets,
  previewAutoBets,
  type AutoBetCriteria,
  type AutoBetExclude,
  type PreviewItem,
} from "@/lib/autobet";

const CRITERIA: AutoBetCriteria[] = ["draw", "my_teams", "home", "away", "favorite", "underdog"];
const EXCLUDES: AutoBetExclude[] = ["none", "my_team_games", "lopsided", "free_agent"];

export interface RuleInput {
  criteria: string;
  exclude: string;
  stake: number;
  horizonDays: number;
}

function normalize(input: RuleInput) {
  const criteria = (CRITERIA as string[]).includes(input.criteria)
    ? (input.criteria as AutoBetCriteria)
    : "draw";
  const exclude = (EXCLUDES as string[]).includes(input.exclude)
    ? (input.exclude as AutoBetExclude)
    : "none";
  const stake = Math.max(1, Math.round(Number(input.stake) || 0));
  const horizonDays = Math.max(1, Math.round(Number(input.horizonDays) || 0));
  return { criteria, exclude, stake, horizonDays };
}

function refresh() {
  revalidatePath("/bets");
  revalidatePath("/");
}

// Verify a rule exists AND belongs to the signed-in manager. Returns the
// person's id when authorized, else null.
async function ownedRule(ruleId: number): Promise<number | null> {
  const me = await getCurrentManager();
  if (!me) return null;
  const rule = await getRuleById(ruleId);
  if (!rule || rule.personId !== me.personId) return null;
  return me.personId;
}

// Create a new rule. If active, place once immediately (no waiting for the cron).
export async function createRuleAction(input: RuleInput & { active: boolean }) {
  const me = await getCurrentManager();
  if (!me) return;
  const settings = normalize(input);
  const active = !!input.active;
  await createRule({ personId: me.personId, ...settings, active });
  if (active) await runAutoBets({ personId: me.personId });
  refresh();
}

// Update an existing rule's settings (active flag preserved). Re-runs if active.
export async function updateRuleAction(ruleId: number, input: RuleInput) {
  const personId = await ownedRule(ruleId);
  if (personId == null) return;
  const rule = await getRuleById(ruleId);
  const settings = normalize(input);
  await updateRule(ruleId, settings);
  if (rule?.active) await runAutoBets({ personId });
  refresh();
}

// Turn a rule on/off. Activating places once immediately.
export async function setRuleActiveAction(ruleId: number, active: boolean) {
  const personId = await ownedRule(ruleId);
  if (personId == null) return;
  await setRuleActive(ruleId, active);
  if (active) await runAutoBets({ personId });
  refresh();
}

export async function deleteRuleAction(ruleId: number) {
  const personId = await ownedRule(ruleId);
  if (personId == null) return;
  await deleteRule(ruleId);
  refresh();
}

// Reorder a rule's priority among the person's rules.
export async function moveRuleAction(ruleId: number, direction: "up" | "down") {
  const personId = await ownedRule(ruleId);
  if (personId == null) return;
  await moveRule(ruleId, direction);
  refresh();
}

// Force a placement run now (all the person's active rules; idempotent).
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

// Dry run of specific (unsaved) settings — powers each card's Preview button +
// the activate confirmation modal. No writes.
export async function previewAutoBetAction(input: RuleInput): Promise<PreviewItem[]> {
  const me = await getCurrentManager();
  if (!me) return [];
  const settings = normalize(input);
  return previewAutoBets(me.personId, undefined, settings);
}
