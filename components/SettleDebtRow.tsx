"use client";

import { useState, useTransition } from "react";
import { styleFor } from "@/lib/managers";
import { NumberInput } from "@/components/NumberInput";
import { markPaidAction } from "@/app/bets/actions";

function MgrChip({ name }: { name: string }) {
  const s = styleFor(name);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
      {name}
    </span>
  );
}

// One outstanding-debt line. `from` owes `to` $amount. Buttons depend on who the
// viewer is:
//   debtor (myName === from):   Pay on Venmo + "I paid" (full) + a "custom" partial.
//   creditor (myName === to):   "Mark received" (no Venmo — only the debtor pays).
//   bystander (neither):        plain text, no buttons, no Venmo.
export function SettleDebtRow({
  from,
  to,
  amount,
  myName,
}: {
  from: string;
  to: string;
  amount: number;
  myName: string | null;
}) {
  const isDebtor = myName != null && myName === from;
  const isCreditor = myName != null && myName === to;

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [customAmount, setCustomAmount] = useState(amount);

  const venmo = `https://venmo.com/?txn=pay&amount=${amount}&note=${encodeURIComponent("World Cup bets")}`;

  const pay = (payAmount: number) =>
    startTransition(async () => {
      setError(null);
      const res = await markPaidAction({ fromName: from, toName: to, amount: payAmount });
      if (!res.ok) setError(res.error);
    });

  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-400">
          <MgrChip name={from} />
          <span>owes</span>
          <MgrChip name={to} />
          <span className="tabular-nums font-semibold text-zinc-200">${amount}</span>
        </span>

        {isDebtor && (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={venmo}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25 transition whitespace-nowrap"
            >
              Pay on Venmo
            </a>
            <button
              disabled={pending}
              onClick={() => pay(amount)}
              className="rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition disabled:opacity-50 whitespace-nowrap"
            >
              I paid
            </button>
            <button
              disabled={pending}
              onClick={() => {
                setCustomAmount(amount);
                setCustom((c) => !c);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition disabled:opacity-50"
            >
              custom
            </button>
          </div>
        )}

        {isCreditor && (
          <button
            disabled={pending}
            onClick={() => pay(amount)}
            className="rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition disabled:opacity-50 whitespace-nowrap"
          >
            Mark received
          </button>
        )}
      </div>

      {isDebtor && custom && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Log a partial payment of $</span>
          <NumberInput
            value={customAmount}
            onChange={(n) => setCustomAmount(n)}
            min={1}
            ariaLabel="Partial payment amount"
            className="w-20 rounded-md bg-white/5 border border-white/10 px-2 py-1 text-sm tabular-nums outline-none focus:border-white/30"
          />
          <button
            disabled={pending || customAmount < 1 || customAmount > amount}
            onClick={() => pay(customAmount)}
            className="rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition disabled:opacity-50 whitespace-nowrap"
          >
            Log payment
          </button>
          {customAmount > amount && (
            <span className="text-xs text-zinc-600">max ${amount}</span>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </li>
  );
}
