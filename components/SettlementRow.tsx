"use client";

import { useState, useTransition } from "react";
import { styleFor } from "@/lib/managers";
import { RelativeTime } from "@/components/RelativeTime";
import { confirmSettlementAction, undoSettlementAction } from "@/app/bets/actions";
import type { AckStatus } from "@/lib/settlements";

function MgrChip({ name }: { name: string }) {
  const s = styleFor(name);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
      {name}
    </span>
  );
}

function StatusChip({ status }: { status: AckStatus }) {
  if (status === "paid") {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
        ✓ Paid
      </span>
    );
  }
  const label = status === "payer_marked" ? "Payer marked paid" : "Payee marked paid";
  return (
    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
      {label}
    </span>
  );
}

// One settlement (payment) row. `from` paid `to` $amount.
// - When the payment is half-acked and the viewer is the party whose ack is
//   still missing, they can Confirm:
//     payer_marked -> the payee (to) confirms; payee_marked -> the payer (from) confirms.
// - Any party (from or to) can Undo their own ack.
export function SettlementRow({
  id,
  from,
  to,
  amount,
  ackStatus,
  createdAt,
  note,
  myName,
}: {
  id: number;
  from: string;
  to: string;
  amount: number;
  ackStatus: AckStatus;
  createdAt: string;
  note: string | null;
  myName: string | null;
}) {
  const isParty = myName != null && (myName === from || myName === to);
  const canConfirm =
    (ackStatus === "payer_marked" && myName === to) ||
    (ackStatus === "payee_marked" && myName === from);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
    });

  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-400">
          <MgrChip name={from} />
          <span>paid</span>
          <MgrChip name={to} />
          <span className="tabular-nums font-semibold text-zinc-200">${amount}</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={ackStatus} />
          <RelativeTime iso={createdAt} />
          {canConfirm && (
            <button
              disabled={pending}
              onClick={() => run(() => confirmSettlementAction(id))}
              className="rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition disabled:opacity-50 whitespace-nowrap"
            >
              Confirm
            </button>
          )}
          {isParty && (
            <button
              disabled={pending}
              onClick={() => run(() => undoSettlementAction(id))}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition disabled:opacity-50"
            >
              Undo
            </button>
          )}
        </div>
      </div>
      {note && <p className="text-xs text-zinc-600">{note}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </li>
  );
}
