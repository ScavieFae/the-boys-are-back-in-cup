"use client";

import { useState, useTransition } from "react";
import type { PreviewItem } from "@/lib/autobet";
import {
  saveAutoBetAction,
  activateAutoBetAction,
  deactivateAutoBetAction,
  runNowAction,
  previewAutoBetAction,
} from "@/app/autobet-actions";

const CRITERIA_OPTIONS: { value: string; label: string }[] = [
  { value: "draw", label: "Always Draw" },
  { value: "my_teams", label: "My Teams" },
  { value: "home", label: "Always Home" },
  { value: "away", label: "Always Away" },
  { value: "favorite", label: "Favorite" },
  { value: "underdog", label: "Underdog" },
];

function outcomeWord(o: string): string {
  return o === "home" ? "Home" : o === "away" ? "Away" : "Draw";
}

function PreviewList({ items }: { items: PreviewItem[] }) {
  if (items.length === 0) return <p className="text-sm text-zinc-500">Nothing to place — click Preview after setting your rule.</p>;
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

export function AutoBetControls({
  initial,
  initialPreview,
}: {
  initial: { criteria: string; stake: number; horizonDays: number; active: boolean };
  initialPreview: PreviewItem[];
}) {
  const [criteria, setCriteria] = useState(initial.criteria);
  const [stake, setStake] = useState(initial.stake);
  const [horizonDays, setHorizonDays] = useState(initial.horizonDays);
  const [preview, setPreview] = useState<PreviewItem[]>(initialPreview);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();
  const active = initial.active;

  const input = () => ({ criteria, stake, horizonDays });
  const total = preview.reduce((s, p) => s + p.amount, 0);

  async function refreshPreview() {
    const items = await previewAutoBetAction(input());
    setPreview(items);
    return items;
  }

  const doPreview = () => start(async () => { await refreshPreview(); });
  const doSave = () => start(async () => { await saveAutoBetAction(input()); await refreshPreview(); });
  const openConfirm = () => start(async () => { await refreshPreview(); setConfirmOpen(true); });
  const doActivate = () => start(async () => { await activateAutoBetAction(input()); setConfirmOpen(false); });
  const doDeactivate = () => start(async () => { await deactivateAutoBetAction(input()); });
  const doRunNow = () => start(async () => { await runNowAction(); });

  const criteriaLabel = CRITERIA_OPTIONS.find((o) => o.value === criteria)?.label ?? criteria;
  const fieldCls = "w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none focus:border-white/30";
  const btn = "rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50";

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Rule</span>
          <select value={criteria} onChange={(e) => setCriteria(e.target.value)} className={fieldCls}>
            {CRITERIA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Stake / budget ($)</span>
          <input type="number" min={1} value={stake} onChange={(e) => setStake(Math.max(1, Math.round(Number(e.target.value) || 0)))} className={`${fieldCls} tabular-nums`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Horizon (days)</span>
          <input type="number" min={1} value={horizonDays} onChange={(e) => setHorizonDays(Math.max(1, Math.round(Number(e.target.value) || 0)))} className={`${fieldCls} tabular-nums`} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs">
          {active ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Auto-bet is ON
            </span>
          ) : (
            <span className="text-zinc-500">Auto-bet is off</span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={doPreview} disabled={pending} className={`${btn} border border-white/15 text-zinc-200 hover:bg-white/5`}>Preview</button>
          {active ? (
            <>
              <button onClick={doSave} disabled={pending} className={`${btn} border border-white/15 text-zinc-200 hover:bg-white/5`}>Save changes</button>
              <button onClick={doRunNow} disabled={pending} className={`${btn} border border-white/15 text-zinc-200 hover:bg-white/5`}>Run now</button>
              <button onClick={doDeactivate} disabled={pending} className={`${btn} bg-red-500/15 text-red-300 hover:bg-red-500/25`}>Deactivate</button>
            </>
          ) : (
            <>
              <button onClick={doSave} disabled={pending} className={`${btn} border border-white/15 text-zinc-200 hover:bg-white/5`}>Save</button>
              <button onClick={openConfirm} disabled={pending} className={`${btn} bg-emerald-500 text-black hover:bg-emerald-400`}>Activate Auto-Bet</button>
            </>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">
        {active
          ? "Placing automatically. “Run now” forces a placement immediately; “Deactivate” stops new ones (open bets stay until you cancel them below)."
          : "“Activate” places the previewed bets once right now, then keeps placing as new games enter your window."}
      </p>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 text-zinc-500">
          What this would place {preview.length > 0 && <span className="text-zinc-600">· {preview.length} bet{preview.length === 1 ? "" : "s"} · ${total}</span>}
        </h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <PreviewList items={preview} />
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">Activate auto-bet?</h3>
            <p className="text-xs text-zinc-500 mb-3">
              <span className="text-zinc-300">{criteriaLabel}</span> · ${stake} budget/match · next {horizonDays} day{horizonDays === 1 ? "" : "s"}.
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
    </div>
  );
}
