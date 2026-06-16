"use client";

import { useState, useTransition } from "react";
import { deVig, computeBuyins, OUTCOMES, type Outcome } from "@/lib/betting";
import type { PoolView } from "@/lib/bets";
import { createBetAction, takeSpotAction, cancelBetAction } from "@/app/bets/actions";

export interface MatchBettingProps {
  match: {
    id: number;
    homeName: string;
    homeCode: string | null;
    awayName: string;
    awayCode: string | null;
    status: string; // pre | in | post
    odds: { home: string | null; draw: string | null; away: string | null } | null;
  };
  pools: PoolView[]; // open pools for this match
  currentManager: string | null;
}

function labelFor(o: Outcome, m: MatchBettingProps["match"]): string {
  return o === "home" ? m.homeName : o === "away" ? m.awayName : "Draw";
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function MatchBetting({ match, pools, currentManager }: MatchBettingProps) {
  const [creating, setCreating] = useState(false);
  const [takeTarget, setTakeTarget] = useState<{ pool: PoolView; outcome: Outcome } | null>(null);

  const canBet = match.status !== "post";
  const hasLine = !!(match.odds && match.odds.home && match.odds.draw && match.odds.away);

  return (
    <div className="mt-2 pt-2 border-t border-white/5">
      {pools.length > 0 && (
        <div className="space-y-2 mb-2">
          {pools.map((p) => (
            <PoolRow
              key={p.id}
              pool={p}
              match={match}
              currentManager={currentManager}
              canBet={canBet}
              onTake={(outcome) => setTakeTarget({ pool: p, outcome })}
            />
          ))}
        </div>
      )}

      {canBet && hasLine && (
        currentManager ? (
          <button
            onClick={() => setCreating(true)}
            className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
          >
            + New bet
          </button>
        ) : (
          <span className="text-[11px] text-zinc-600">Sign in to bet</span>
        )
      )}

      {creating && (
        <CreateModal match={match} onClose={() => setCreating(false)} />
      )}
      {takeTarget && (
        <TakeModal
          pool={takeTarget.pool}
          outcome={takeTarget.outcome}
          match={match}
          onClose={() => setTakeTarget(null)}
        />
      )}
    </div>
  );
}

function PoolRow({
  pool,
  match,
  currentManager,
  canBet,
  onTake,
}: {
  pool: PoolView;
  match: MatchBettingProps["match"];
  currentManager: string | null;
  canBet: boolean;
  onTake: (o: Outcome) => void;
}) {
  const [pending, startTransition] = useTransition();
  const youAreIn = OUTCOMES.some((o) => pool.spots[o].manager === currentManager);
  const isCreator = pool.createdBy === currentManager;

  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2 text-[11px]">
      <div className="flex items-center justify-between mb-1 text-zinc-500">
        <span>🎲 {pool.createdBy}&apos;s bet · pot ${pool.currentPot}{pool.filledCount < 3 ? `–$${pool.fullPot}` : ""}</span>
        {isCreator && canBet && pool.filledCount < 2 && (
          <button
            disabled={pending}
            onClick={() => startTransition(async () => { await cancelBetAction({ poolId: pool.id }); })}
            className="text-zinc-500 hover:text-red-400"
          >
            cancel
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {OUTCOMES.map((o) => {
          const spot = pool.spots[o];
          const open = !spot.manager;
          const takeable = canBet && open && currentManager && !youAreIn;
          return (
            <div key={o} className={`rounded px-1.5 py-1 ${open ? "bg-white/[0.02]" : "bg-white/[0.06]"}`}>
              <div className="text-zinc-500 truncate">{labelFor(o, match)}</div>
              {spot.manager ? (
                <div className="text-zinc-200 font-medium truncate">{spot.manager}</div>
              ) : takeable ? (
                <button onClick={() => onTake(o)} className="text-emerald-400 hover:text-emerald-300 font-medium">
                  Take ${spot.buyin}
                </button>
              ) : (
                <div className="text-zinc-600">open ${spot.buyin}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateModal({ match, onClose }: { match: MatchBettingProps["match"]; onClose: () => void }) {
  const [outcome, setOutcome] = useState<Outcome>("home");
  const [buyin, setBuyin] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const probs = match.odds ? deVig(match.odds) : null;
  const preview = probs && buyin >= 1 ? computeBuyins(probs, outcome, Math.round(buyin)) : null;
  const adjusted: Record<Outcome, number> | null = preview
    ? { home: Math.max(1, preview.home), draw: Math.max(1, preview.draw), away: Math.max(1, preview.away) }
    : null;
  if (adjusted) adjusted[outcome] = Math.round(buyin);
  const fullPot = adjusted ? adjusted.home + adjusted.draw + adjusted.away : 0;
  const yourWin = adjusted ? fullPot - adjusted[outcome] : 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createBetAction({ matchId: match.id, outcome, buyin: Math.round(buyin) });
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <Overlay onClose={onClose}>
      <h3 className="font-semibold mb-1">New bet · {match.homeName} v {match.awayName}</h3>
      <p className="text-xs text-zinc-500 mb-3">Pick your side and stake. The other spots are priced off the line.</p>

      <div className="grid grid-cols-3 gap-1 mb-3">
        {OUTCOMES.map((o) => (
          <button
            key={o}
            onClick={() => setOutcome(o)}
            className={`rounded-md px-2 py-1.5 text-xs font-medium border ${
              outcome === o ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-white/10 text-zinc-300 hover:bg-white/5"
            }`}
          >
            {labelFor(o, match)}
          </button>
        ))}
      </div>

      <label className="block text-xs text-zinc-500 mb-1">Your buy-in ($)</label>
      <input
        type="number"
        min={1}
        value={buyin}
        onChange={(e) => setBuyin(Math.max(1, Math.round(Number(e.target.value) || 0)))}
        className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm mb-3 outline-none focus:border-white/30"
      />

      {adjusted && (
        <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2.5 text-xs mb-3 space-y-1">
          {OUTCOMES.map((o) => (
            <div key={o} className="flex justify-between">
              <span className={outcome === o ? "text-emerald-300 font-medium" : "text-zinc-400"}>
                {labelFor(o, match)}{outcome === o ? " (you)" : ""}
              </span>
              <span className="tabular-nums">${adjusted[o]}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-white/10 pt-1 text-zinc-300">
            <span>You win (if all 3 fill)</span>
            <span className="tabular-nums font-semibold">+${yourWin}</span>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-md border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5">Cancel</button>
        <button onClick={submit} disabled={pending} className="flex-1 rounded-md bg-emerald-500 text-black px-3 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-50">
          {pending ? "Placing…" : `Place $${Math.round(buyin)}`}
        </button>
      </div>
    </Overlay>
  );
}

function TakeModal({
  pool,
  outcome,
  match,
  onClose,
}: {
  pool: PoolView;
  outcome: Outcome;
  match: MatchBettingProps["match"];
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
