"use client";

import { useState, useTransition } from "react";
import { OUTCOMES, type Outcome } from "@/lib/betting";
import type { PariView } from "@/lib/parimutuel";
import { contributeAction } from "@/app/bets/actions";
import { Overlay } from "@/components/BetModals";
import { NumberInput } from "@/components/NumberInput";

export interface PariPotProps {
  view: PariView | null;
  matchId: number;
  matchStatus: "pre" | "in" | "post";
  homeCode: string | null;
  awayCode: string | null;
  homeName: string;
  awayName: string;
  currentManager: string | null;
}

// outcome -> FIFA code (DRAW for the draw), falling back to the team name so we
// never render an empty token.
function codeFor(o: Outcome, p: PariPotProps): string {
  if (o === "draw") return "DRAW";
  if (o === "home") return p.homeCode ?? p.homeName;
  return p.awayCode ?? p.awayName;
}

export function PariPot(props: PariPotProps) {
  const { view, matchStatus, currentManager } = props;
  const [open, setOpen] = useState(false);

  const pot = view?.pot ?? 0;
  const hasPot = pot > 0;
  const settled = view?.status === "settled";
  const voided = view?.status === "void";
  const result = view?.result ?? null;
  const isPre = matchStatus === "pre";

  // Nothing to show: no pot AND the match is past pre. Render nothing.
  if (!hasPot && !isPre) return null;

  const canContribute = isPre && !!currentManager;

  return (
    <div className="mt-2 pt-2 border-t border-amber-500/15">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-amber-300/90">🍯 Pot</span>
        {hasPot ? (
          <span className="text-[11px] tabular-nums text-zinc-300">
            pot <span className="font-semibold text-amber-200">${pot}</span>
            {settled && result && (
              <span className="ml-1 text-emerald-400">· {codeFor(result, props)} took it</span>
            )}
            {voided && <span className="ml-1 text-zinc-500">· refunded</span>}
          </span>
        ) : (
          isPre && <span className="text-[11px] text-zinc-600">No pot yet — be the first in.</span>
        )}
      </div>

      {hasPot && (
        <div className="grid grid-cols-3 gap-1 mb-1.5">
          {OUTCOMES.map((o) => {
            const oc = view!.outcomes[o] ?? { total: 0, backers: [] };
            const isWinner = settled && result === o;
            return (
              <div
                key={o}
                className={`rounded px-1.5 py-1 text-[11px] ${
                  isWinner ? "bg-emerald-500/10 ring-1 ring-emerald-500/30" : "bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={`font-mono ${isWinner ? "text-emerald-300" : "text-zinc-400"}`}>
                    {isWinner && "✓ "}
                    {codeFor(o, props)}
                  </span>
                  <span className="tabular-nums text-zinc-500">${oc.total}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {oc.backers.map((b, i) => {
                    const share =
                      !settled && !voided && oc.total > 0 ? Math.round((b.amount / oc.total) * pot) : null;
                    return (
                      <span
                        key={`${b.manager}-${i}`}
                        title={share != null ? `would get ~$${share} if ${codeFor(o, props)} hits` : undefined}
                        className="inline-flex items-center rounded bg-white/[0.06] px-1 py-0.5 text-[10px] text-zinc-300"
                      >
                        {b.manager} <span className="ml-0.5 tabular-nums text-zinc-500">${b.amount}</span>
                      </span>
                    );
                  })}
                  {oc.backers.length === 0 && <span className="text-[10px] text-zinc-700">—</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {voided && hasPot && <p className="text-[10px] text-zinc-500 mb-1">Pot refunded — no one had the winner.</p>}

      {canContribute && (
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] font-medium text-amber-400 hover:text-amber-300"
        >
          {view?.mine ? "+ Add to pot" : hasPot ? "+ Join the pot" : "+ Start the pot"}
        </button>
      )}
      {isPre && !currentManager && <span className="text-[11px] text-zinc-600">Sign in to join the pot</span>}

      {open && <ContributeModal {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ContributeModal(props: PariPotProps & { onClose: () => void }) {
  const { view, matchId, homeName, awayName, onClose } = props;
  const lockedOutcome = view?.mine?.outcome ?? null;
  const [outcome, setOutcome] = useState<Outcome>(lockedOutcome ?? "home");
  const [amount, setAmount] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await contributeAction({ matchId, outcome, amount: Math.max(1, Math.round(amount)) });
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <Overlay onClose={onClose}>
      <h3 className="font-semibold mb-1">🍯 Pot · {homeName} v {awayName}</h3>
      {lockedOutcome ? (
        <p className="text-xs text-zinc-500 mb-3">
          Adding to your <span className="text-amber-300 font-medium">{codeFor(lockedOutcome, props)}</span> stake.
          You can top up, but not split across outcomes.
        </p>
      ) : (
        <p className="text-xs text-zinc-500 mb-3">
          Pick one outcome and chip in. The winning side splits the whole pot pro-rata at full-time.
        </p>
      )}

      <div className="grid grid-cols-3 gap-1 mb-3">
        {OUTCOMES.map((o) => {
          const active = outcome === o;
          const locked = lockedOutcome != null && lockedOutcome !== o;
          return (
            <button
              key={o}
              disabled={locked}
              onClick={() => !locked && setOutcome(o)}
              className={`rounded-md px-2 py-1.5 text-xs font-mono font-medium border ${
                active
                  ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
                  : locked
                    ? "border-white/5 text-zinc-700 cursor-not-allowed"
                    : "border-white/10 text-zinc-300 hover:bg-white/5"
              }`}
            >
              {codeFor(o, props)}
            </button>
          );
        })}
      </div>

      <label className="block text-xs text-zinc-500 mb-1">{lockedOutcome ? "Top-up" : "Your stake"} ($)</label>
      <NumberInput
        value={amount}
        onChange={setAmount}
        min={1}
        ariaLabel={lockedOutcome ? "Top-up amount" : "Your stake"}
        className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm mb-3 outline-none focus:border-white/30"
      />

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-md border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5">Cancel</button>
        <button
          onClick={submit}
          disabled={pending || amount < 1}
          className="flex-1 rounded-md bg-amber-500 text-black px-3 py-2 text-sm font-semibold hover:bg-amber-400 disabled:opacity-50"
        >
          {pending ? "Adding…" : amount < 1 ? "Add" : `Add $${Math.round(amount)}`}
        </button>
      </div>
    </Overlay>
  );
}
