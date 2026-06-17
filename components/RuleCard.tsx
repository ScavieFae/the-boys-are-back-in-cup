"use client";

import { useState, useTransition } from "react";
import type { PreviewItem } from "@/lib/autobet";
import {
  createRuleAction,
  updateRuleAction,
  setRuleActiveAction,
  deleteRuleAction,
  moveRuleAction,
  previewAutoBetAction,
  type RuleInput,
} from "@/app/autobet-actions";
import { NumberInput } from "@/components/NumberInput";

const CRITERIA_OPTIONS: { value: string; label: string }[] = [
  { value: "draw", label: "Always Draw" },
  { value: "my_teams", label: "My Teams" },
  { value: "home", label: "Always Home" },
  { value: "away", label: "Always Away" },
  { value: "favorite", label: "Favorite" },
  { value: "underdog", label: "Underdog" },
];

const EXCLUDE_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "None" },
  { value: "my_team_games", label: "My teams' games" },
  { value: "lopsided", label: "Lopsided games" },
  { value: "free_agent", label: "Free-agent games" },
];

function outcomeWord(o: string): string {
  return o === "home" ? "Home" : o === "away" ? "Away" : "Draw";
}

function criteriaLabel(v: string): string {
  return CRITERIA_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

// Short human phrase for the exclude filter, for the confirm modal spec line.
function excludePhrase(v: string): string {
  switch (v) {
    case "my_team_games":
      return " · excluding my teams' games";
    case "lopsided":
      return " · excluding lopsided games";
    case "free_agent":
      return " · excluding free-agent games";
    default:
      return "";
  }
}

function PreviewList({ items }: { items: PreviewItem[] }) {
  if (items.length === 0)
    return <p className="text-sm text-zinc-500">Nothing to place — click Preview after setting this rule.</p>;
  return (
    <ul className="divide-y divide-white/5">
      {items.map((it, i) => (
        <li key={`${it.matchId}-${it.action}-${i}`} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${it.action === "open" ? "bg-sky-500/15 text-sky-300" : "bg-emerald-500/15 text-emerald-300"}`}>{it.action}</span>
            <span className="truncate text-zinc-200">{it.matchLabel}</span>
            <span className="text-zinc-600 shrink-0">·</span>
            <span className="text-zinc-400 shrink-0">{outcomeWord(it.outcome)}</span>
          </div>
          <span className="tabular-nums font-semibold text-zinc-200 shrink-0">${it.amount}</span>
        </li>
      ))}
    </ul>
  );
}

export interface RuleCardData {
  id: number | null; // null = a new, unsaved card
  criteria: string;
  exclude: string;
  stake: number;
  horizonDays: number;
  active: boolean;
}

export function RuleCard({
  rule,
  isFirst,
  isLast,
  onRemoveDraft,
}: {
  rule: RuleCardData;
  isFirst?: boolean;
  isLast?: boolean;
  onRemoveDraft?: () => void;
}) {
  const [criteria, setCriteria] = useState(rule.criteria);
  const [exclude, setExclude] = useState(rule.exclude);
  const [stake, setStake] = useState(rule.stake);
  const [horizonDays, setHorizonDays] = useState(rule.horizonDays);
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [budgetInfo, setBudgetInfo] = useState(false);
  const [pending, start] = useTransition();

  const id = rule.id;
  const isNew = id == null;
  const active = rule.active;
  const total = preview.reduce((s, p) => s + p.amount, 0);

  const input = (): RuleInput => ({ criteria, exclude, stake, horizonDays });

  async function refreshPreview() {
    const items = await previewAutoBetAction(input());
    setPreview(items);
    return items;
  }

  const doPreview = () => start(async () => { await refreshPreview(); });
  const doSave = () =>
    start(async () => {
      if (isNew) {
        await createRuleAction({ ...input(), active: false });
        onRemoveDraft?.();
      } else {
        await updateRuleAction(id!, input());
        await refreshPreview();
      }
    });
  const openConfirm = () => start(async () => { await refreshPreview(); setConfirmOpen(true); });
  const doActivate = () =>
    start(async () => {
      if (isNew) {
        await createRuleAction({ ...input(), active: true });
        onRemoveDraft?.();
      } else {
        await setRuleActiveAction(id!, true);
      }
      setConfirmOpen(false);
    });
  const doDeactivate = () => start(async () => { if (!isNew) await setRuleActiveAction(id!, false); });
  const doDelete = () => start(async () => { if (!isNew) await deleteRuleAction(id!); });
  const doMove = (direction: "up" | "down") => start(async () => { if (!isNew) await moveRuleAction(id!, direction); });

  const fieldCls = "w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none focus:border-white/30";
  const btn = "rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50";
  const valid = stake >= 1 && horizonDays >= 1;
  const specLine = `${criteriaLabel(criteria)}${excludePhrase(exclude)} · $${stake}/match · next ${horizonDays} day${horizonDays === 1 ? "" : "s"}`;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        {/* Reorder controls — saved rules only. */}
        {!isNew && (
          <div className="flex flex-col gap-1 pt-6">
            <button
              onClick={() => doMove("up")}
              disabled={pending || isFirst}
              aria-label="Move rule up (higher priority)"
              className="rounded border border-white/10 px-1.5 text-xs text-zinc-400 hover:bg-white/5 disabled:opacity-30"
            >
              ▲
            </button>
            <button
              onClick={() => doMove("down")}
              disabled={pending || isLast}
              aria-label="Move rule down (lower priority)"
              className="rounded border border-white/10 px-1.5 text-xs text-zinc-400 hover:bg-white/5 disabled:opacity-30"
            >
              ▼
            </button>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Include</span>
              <select value={criteria} onChange={(e) => setCriteria(e.target.value)} className={fieldCls}>
                {CRITERIA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Exclude</span>
              <select value={exclude} onChange={(e) => setExclude(e.target.value)} className={fieldCls}>
                {EXCLUDE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-zinc-500">
                Budget / game ($)
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setBudgetInfo((v) => !v); }}
                  aria-label="How the per-game budget works"
                  aria-expanded={budgetInfo}
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/25 text-[9px] font-bold normal-case leading-none text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                >
                  i
                </button>
              </span>
              <NumberInput value={stake} onChange={setStake} min={1} ariaLabel="Budget per game" className={`${fieldCls} tabular-nums`} />
              {budgetInfo && (
                <p className="mt-1.5 rounded-md border border-white/10 bg-white/[0.03] p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-zinc-400">
                  This is your cap <em className="not-italic text-zinc-300">per game</em>. The rule first joins any open bets on the game that fit your budget (spending up to it, across one or more). If there’s nothing to join, it opens a new bet for the full amount.
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Horizon (days)</span>
              <NumberInput value={horizonDays} onChange={setHorizonDays} min={1} ariaLabel="Horizon in days" className={`${fieldCls} tabular-nums`} />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs">
              {isNew ? (
                <span className="text-zinc-500">New rule (unsaved)</span>
              ) : active ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> ON
                </span>
              ) : (
                <span className="text-zinc-500">Off</span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={doPreview} disabled={pending || !valid} className={`${btn} border border-white/15 text-zinc-200 hover:bg-white/5`}>Preview</button>
              <button onClick={doSave} disabled={pending || !valid} className={`${btn} border border-white/15 text-zinc-200 hover:bg-white/5`}>
                {isNew ? "Save" : "Save changes"}
              </button>
              {!isNew && active ? (
                <button onClick={doDeactivate} disabled={pending} className={`${btn} bg-red-500/15 text-red-300 hover:bg-red-500/25`}>Deactivate</button>
              ) : (
                <button onClick={openConfirm} disabled={pending || !valid} className={`${btn} bg-emerald-500 text-black hover:bg-emerald-400`}>Activate</button>
              )}
              {isNew ? (
                onRemoveDraft && (
                  <button onClick={onRemoveDraft} disabled={pending} className={`${btn} text-zinc-400 hover:bg-white/5`}>Discard</button>
                )
              ) : (
                <button onClick={() => setConfirmDelete(true)} disabled={pending} className={`${btn} text-zinc-500 hover:bg-white/5`}>Delete</button>
              )}
            </div>
          </div>

          {preview.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 text-zinc-500">
                What this would place <span className="text-zinc-600">· {preview.length} bet{preview.length === 1 ? "" : "s"} · ${total}</span>
              </h4>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <PreviewList items={preview} />
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">Activate auto-bet?</h3>
            <p className="text-xs text-zinc-500 mb-3">
              <span className="text-zinc-300">{specLine}</span> ·{" "}
              <span className="font-medium text-emerald-400">🔁 repeats daily</span>
            </p>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2.5 text-[11px] text-amber-300 mb-3">
              This places <strong>{preview.length} bet{preview.length === 1 ? "" : "s"} now</strong> (about <strong>${total}</strong> committed if filled), then keeps placing automatically as new games qualify. Open bets lock once someone joins.
            </div>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] p-3 mb-3">
              <PreviewList items={preview} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmOpen(false)} className="flex-1 rounded-md border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5">Cancel</button>
              <button onClick={doActivate} disabled={pending} className="flex-1 rounded-md bg-emerald-500 text-black px-3 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-50">
                {pending ? "Activating…" : "Confirm & Activate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={() => setConfirmDelete(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">Delete this rule?</h3>
            <p className="text-xs text-zinc-500 mb-3">{specLine}. Open bets it already placed stay until you cancel them below.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-md border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5">Cancel</button>
              <button onClick={() => { setConfirmDelete(false); doDelete(); }} disabled={pending} className="flex-1 rounded-md bg-red-500/20 text-red-300 px-3 py-2 text-sm font-semibold hover:bg-red-500/30 disabled:opacity-50">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
