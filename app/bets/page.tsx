import { getAllPoolViews, getLedger, type PoolView } from "@/lib/bets";
import { getCurrentManager } from "@/lib/auth-guard";
import { styleFor } from "@/lib/managers";
import { KickoffTime } from "@/components/KickoffTime";
import type { Outcome } from "@/lib/betting";

export const dynamic = "force-dynamic";

const OUTCOME_ORDER: Outcome[] = ["home", "draw", "away"];

function MgrChip({ name, className = "" }: { name: string; className?: string }) {
  const s = styleFor(name);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip} ${className}`}>
      {name}
    </span>
  );
}

function outcomeLabel(pool: PoolView, outcome: Outcome): string {
  if (outcome === "home") return pool.match.homeName;
  if (outcome === "away") return pool.match.awayName;
  return "Draw";
}

function MatchLine({ pool }: { pool: PoolView }) {
  const { match } = pool;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[10px] text-zinc-500 shrink-0">{match.homeCode ?? "—"}</span>
        <span className="truncate text-zinc-200">{match.homeName}</span>
        <span className="text-zinc-600 shrink-0">v</span>
        <span className="truncate text-zinc-200">{match.awayName}</span>
        <span className="font-mono text-[10px] text-zinc-500 shrink-0">{match.awayCode ?? "—"}</span>
      </div>
      <span className="text-xs text-zinc-500 shrink-0">
        {match.groupLetter ? `Group ${match.groupLetter}` : ""}
      </span>
    </div>
  );
}

function Spot({
  pool,
  outcome,
  mine,
}: {
  pool: PoolView;
  outcome: Outcome;
  mine: boolean;
}) {
  const spot = pool.spots[outcome];
  return (
    <div
      className={`rounded-lg border p-2.5 text-center ${
        mine ? "border-white/25 bg-white/[0.06]" : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-zinc-500 truncate">
        {outcomeLabel(pool, outcome)}
      </div>
      <div className="mt-1.5">
        {spot.manager ? (
          <MgrChip name={spot.manager} />
        ) : (
          <span className="text-xs text-zinc-500">
            open <span className="text-zinc-300 tabular-nums">${spot.buyin}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function OpenPoolCard({ pool, me }: { pool: PoolView; me: string | null }) {
  const incomplete = pool.filledCount < 3;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-1">
        <MatchLine pool={pool} />
      </div>
      <div className="mb-3 text-xs text-zinc-600">
        <KickoffTime iso={pool.match.kickoffUtc} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {OUTCOME_ORDER.map((o) => (
          <Spot key={o} pool={pool} outcome={o} mine={me != null && pool.spots[o].manager === me} />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
        <span>
          started by <MgrChip name={pool.createdBy} className="ml-0.5" />
        </span>
        <span className="tabular-nums">
          <span className="text-zinc-300 font-semibold">${pool.currentPot}</span>
          {incomplete && <span className="text-zinc-600"> –${pool.fullPot}</span>}
        </span>
      </div>
    </div>
  );
}

function SettledRow({ pool }: { pool: PoolView }) {
  const result = pool.result;
  const winningSpot = result ? pool.spots[result] : null;
  const isPush = result != null && (winningSpot == null || winningSpot.manager == null);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <MatchLine pool={pool} />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-500">
          {result ? (
            <>
              <span className="text-zinc-600">result</span>
              <span className="text-zinc-300">{outcomeLabel(pool, result)}</span>
            </>
          ) : (
            <span className="text-zinc-600">settled</span>
          )}
        </div>
        {isPush ? (
          <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-zinc-400">Push</span>
        ) : winningSpot?.manager ? (
          <span className="flex items-center gap-1.5 text-zinc-500">
            <MgrChip name={winningSpot.manager} />
            <span className="text-emerald-400 font-semibold">won</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SettleUp({
  ledger,
}: {
  ledger: Awaited<ReturnType<typeof getLedger>>;
}) {
  const { debts, totals, pushes } = ledger;

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Settle Up</h2>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        {debts.length === 0 ? (
          <p className="text-sm text-zinc-500">
            All square — nobody owes anybody. {pushes > 0 ? `${pushes} push${pushes === 1 ? "" : "es"} so far.` : "Place a bet to get the ledger moving."}
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {debts.map((d) => {
              const venmo = `https://venmo.com/?txn=pay&amount=${d.amount}&note=${encodeURIComponent("World Cup bets")}`;
              return (
                <li key={`${d.from}>${d.to}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-400">
                    <MgrChip name={d.from} />
                    <span>owes</span>
                    <MgrChip name={d.to} />
                    <span className="tabular-nums font-semibold text-zinc-200">${d.amount}</span>
                  </span>
                  <a
                    href={venmo}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25 transition whitespace-nowrap"
                  >
                    Pay on Venmo
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {debts.length > 0 && (
        <p className="mt-2 text-[11px] text-zinc-600">
          We don&apos;t store Venmo usernames yet — the Venmo link opens with the amount filled in, then you pick the person you owe.
        </p>
      )}

      {totals.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 text-zinc-500">Net Winnings</h3>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 divide-y divide-white/5">
            {totals.map((t) => {
              const tone = t.net > 0 ? "text-emerald-400" : t.net < 0 ? "text-red-400" : "text-zinc-400";
              const sign = t.net > 0 ? "+" : t.net < 0 ? "−" : "";
              return (
                <div key={t.manager} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <MgrChip name={t.manager} />
                    <span className="text-[11px] text-zinc-600">{t.settledBets} bet{t.settledBets === 1 ? "" : "s"}</span>
                  </div>
                  <span className={`tabular-nums font-semibold ${tone}`}>
                    {sign}${Math.abs(t.net)}
                  </span>
                </div>
              );
            })}
          </div>
          {pushes > 0 && (
            <p className="mt-2 text-[11px] text-zinc-600">
              {pushes} push{pushes === 1 ? "" : "es"} — winning outcome had no taker, so buy-ins went back.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default async function BetsPage() {
  let me: string | null = null;
  try {
    me = (await getCurrentManager())?.manager ?? null;
  } catch {
    me = null;
  }

  const [ledger, { open, settled }] = await Promise.all([getLedger(), getAllPoolViews()]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Bets</h1>
        <p className="text-zinc-500 text-sm mt-1">
          The three-spot pool — who owes whom, what&apos;s still open, and how it all shook out.
        </p>
      </div>

      <SettleUp ledger={ledger} />

      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Open Bets</h2>
        {open.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-zinc-500">No open bets right now. Start one from a match on the home page.</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-zinc-600">Open spots are taken from the match on the home page.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {open.map((p) => (
                <OpenPoolCard key={p.id} pool={p} me={me} />
              ))}
            </div>
          </>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">History</h2>
        {settled.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-zinc-500">No settled bets yet — the ledger fills up as matches finish.</p>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {settled.map((p) => (
              <SettledRow key={p.id} pool={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
