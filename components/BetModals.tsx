"use client";

import { useState, useTransition } from "react";
import { deVig, computeBuyins, OUTCOMES, type Outcome } from "@/lib/betting";
import type { PoolView } from "@/lib/bets";
import { takeSpotAction, editBetAction } from "@/app/bets/actions";

// The match shape the shared modals need. TakeModal ignores odds; EditModal uses
// match.odds for its live re-price preview.
export interface BetMatch {
  id: number;
  homeName: string;
  homeCode: string | null;
  awayName: string;
  awayCode: string | null;
  status: string; // pre | in | post
  odds: { home: string | null; draw: string | null; away: string | null } | null;
}

export function labelFor(o: Outcome, m: BetMatch): string {
  return o === "home" ? m.homeName : o === "away" ? m.awayName : "Draw";
}

export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function EditModal({
  pool,
  match,
  onClose,
}: {
  pool: PoolView;
  match: BetMatch;
  onClose: () => void;
}) {
  // The creator's pick is fixed — it's the spot they hold. Only the budget changes.
  const creatorOutcome = OUTCOMES.find((o) => pool.spots[o].manager === pool.createdBy) ?? "home";
  const [buyin, setBuyin] = useState(pool.spots[creatorOutcome].buyin);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const probs = match.odds ? deVig(match.odds) : null;
  const preview = probs && buyin >= 1 ? computeBuyins(probs, creatorOutcome, Math.round(buyin)) : null;
  const proposed: Record<Outcome, number> | null = preview
    ? { home: Math.max(1, preview.home), draw: Math.max(1, preview.draw), away: Math.max(1, preview.away) }
    : null;
  if (proposed) proposed[creatorOutcome] = Math.round(buyin);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await editBetAction({ poolId: pool.id, buyin: Math.round(buyin) });
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <Overlay onClose={onClose}>
      <h3 className="font-semibold mb-1">Edit bet · {match.homeName} v {match.awayName}</h3>
      <p className="text-xs text-zinc-500 mb-3">
        Your pick stays <span className="text-zinc-300 font-medium">{labelFor(creatorOutcome, match)}</span>. Change the budget and the other spots re-price.
      </p>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2.5 text-[11px] text-amber-300 mb-3">
        ⚠️ Editing re-prices this bet against the <strong>current line</strong>. The other spots&apos; buy-ins update to the amounts shown below.
      </div>

      <label className="block text-xs text-zinc-500 mb-1">New buy-in ($)</label>
      <input
        type="number"
        min={1}
        value={buyin}
        onChange={(e) => setBuyin(Math.max(1, Math.round(Number(e.target.value) || 0)))}
        className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm mb-3 outline-none focus:border-white/30"
      />

      {proposed && (
        <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2.5 text-xs mb-3 space-y-1">
          {OUTCOMES.map((o) => (
            <div key={o} className="flex justify-between">
              <span className={creatorOutcome === o ? "text-emerald-300 font-medium" : "text-zinc-400"}>
                {labelFor(o, match)}{creatorOutcome === o ? " (you)" : ""}
              </span>
              <span className="tabular-nums text-zinc-500">
                ${pool.spots[o].buyin} <span className="text-zinc-600">→</span>{" "}
                <span className="text-zinc-200">${proposed[o]}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-md border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5">Back</button>
        <button onClick={submit} disabled={pending} className="flex-1 rounded-md bg-emerald-500 text-black px-3 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-50">
          {pending ? "Saving…" : `Save $${Math.round(buyin)}`}
        </button>
      </div>
    </Overlay>
  );
}

export function TakeModal({
  pool,
  outcome,
  match,
  onClose,
}: {
  pool: PoolView;
  outcome: Outcome;
  match: BetMatch;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const buyin = pool.spots[outcome].buyin;
  // Potential winnings = current pot + your buy-in's worth of others already in.
  const potAfter = pool.currentPot + buyin;
  const yourWin = potAfter - buyin;
  const drawOpen = !pool.spots.draw.manager;
  const isTeamBet = outcome === "home" || outcome === "away";

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await takeSpotAction({ poolId: pool.id, outcome });
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <Overlay onClose={onClose}>
      <h3 className="font-semibold mb-1">Take {labelFor(outcome, match)} · ${buyin}</h3>
      <p className="text-xs text-zinc-500 mb-3">{pool.createdBy}&apos;s bet on {match.homeName} v {match.awayName}.</p>

      <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2.5 text-xs mb-3 space-y-1">
        <div className="flex justify-between"><span className="text-zinc-400">Your buy-in</span><span className="tabular-nums">${buyin}</span></div>
        <div className="flex justify-between"><span className="text-zinc-400">You win if {labelFor(outcome, match)}</span><span className="tabular-nums font-semibold text-emerald-300">+${yourWin}</span></div>
        <div className="text-zinc-600">(grows if the third spot fills)</div>
      </div>

      {isTeamBet && drawOpen && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2.5 text-[11px] text-amber-300 mb-3">
          ⚠️ Draw spot is open. As it stands, <strong>a draw refunds you</strong>. But if someone takes the draw spot before kickoff, <strong>a draw means you lose your ${buyin}</strong>.
        </div>
      )}
      {outcome === "draw" && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-[11px] text-zinc-400 mb-3">
          You win only on a draw. Any winner (either team) and you lose your ${buyin}.
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-md border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5">Back</button>
        <button onClick={submit} disabled={pending} className="flex-1 rounded-md bg-emerald-500 text-black px-3 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-50">
          {pending ? "Taking…" : `Take $${buyin}`}
        </button>
      </div>
    </Overlay>
  );
}
