"use client";

import { useState, useTransition } from "react";
import { OUTCOMES, type Outcome } from "@/lib/betting";
import type { PoolView } from "@/lib/bets";
import { styleFor } from "@/lib/managers";
import { cancelBetAction } from "@/app/bets/actions";
import { TakeModal, EditModal, type BetMatch } from "@/components/BetModals";

const OUTCOME_ORDER: Outcome[] = ["home", "draw", "away"];

function outcomeLabel(pool: PoolView, outcome: Outcome): string {
  if (outcome === "home") return pool.match.homeName;
  if (outcome === "away") return pool.match.awayName;
  return "Draw";
}

function MgrChip({ name }: { name: string }) {
  const s = styleFor(name);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
      {name}
    </span>
  );
}

export function OpenBetActions({
  pool,
  currentManager,
}: {
  pool: PoolView;
  currentManager: string | null;
}) {
  const [takeOutcome, setTakeOutcome] = useState<Outcome | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const match: BetMatch = {
    id: pool.matchId,
    homeName: pool.match.homeName,
    homeCode: pool.match.homeCode,
    awayName: pool.match.awayName,
    awayCode: pool.match.awayCode,
    status: pool.match.status,
    odds: pool.match.odds,
  };

  const canBet = pool.match.status !== "post";
  const hasLine = !!(match.odds && match.odds.home && match.odds.draw && match.odds.away);
  const youAreIn = OUTCOMES.some((o) => pool.spots[o].manager === currentManager);
  const isCreator = currentManager != null && pool.createdBy === currentManager;
  const manageable = isCreator && canBet && pool.filledCount < 2;

  return (
    <>
      {manageable && (
        <div className="mb-2 flex items-center justify-end gap-3 text-xs text-zinc-500">
          {hasLine && (
            <button onClick={() => setEditing(true)} className="hover:text-emerald-400">
              edit
            </button>
          )}
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await cancelBetAction({ poolId: pool.id });
                if (!res.ok) setError(res.error);
              })
            }
            className="hover:text-red-400 disabled:opacity-50"
          >
            cancel
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {OUTCOME_ORDER.map((o) => {
          const spot = pool.spots[o];
          const open = !spot.manager;
          const mine = currentManager != null && spot.manager === currentManager;
          const takeable = canBet && open && currentManager != null && !youAreIn;
          return (
            <div
              key={o}
              className={`rounded-lg border p-2.5 text-center ${
                mine ? "border-white/25 bg-white/[0.06]" : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 truncate">
                {outcomeLabel(pool, o)}
              </div>
              <div className="mt-1.5">
                {spot.manager ? (
                  <MgrChip name={spot.manager} />
                ) : takeable ? (
                  <button
                    onClick={() => setTakeOutcome(o)}
                    className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
                  >
                    Take <span className="tabular-nums">${spot.buyin}</span>
                  </button>
                ) : (
                  <span className="text-xs text-zinc-500">
                    open <span className="text-zinc-300 tabular-nums">${spot.buyin}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {takeOutcome && (
        <TakeModal
          pool={pool}
          outcome={takeOutcome}
          match={match}
          onClose={() => setTakeOutcome(null)}
        />
      )}
      {editing && <EditModal pool={pool} match={match} onClose={() => setEditing(false)} />}
    </>
  );
}
