import Link from "next/link";
import { getAllPoolViews, getLedger, type PoolView } from "@/lib/bets";
import { getAllPariViews, type PariView } from "@/lib/parimutuel";
import { getSettlements } from "@/lib/settlements";
import { getCurrentManager } from "@/lib/auth-guard";
import { styleFor } from "@/lib/managers";
import { KickoffTime } from "@/components/KickoffTime";
import { AutoBetPanel } from "@/components/AutoBetPanel";
import { OpenBetActions } from "@/components/OpenBetActions";
import { SettleDebtRow } from "@/components/SettleDebtRow";
import { SettlementRow } from "@/components/SettlementRow";
import { OUTCOMES, type Outcome } from "@/lib/betting";

export const dynamic = "force-dynamic";

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
      <Link href={`/match/${pool.matchId}`} className="flex items-center gap-2 min-w-0 transition hover:text-white">
        <span className="font-mono text-[10px] text-zinc-500 shrink-0">{match.homeCode ?? "—"}</span>
        <span className="truncate text-zinc-200">{match.homeName}</span>
        <span className="text-zinc-600 shrink-0">v</span>
        <span className="truncate text-zinc-200">{match.awayName}</span>
        <span className="font-mono text-[10px] text-zinc-500 shrink-0">{match.awayCode ?? "—"}</span>
      </Link>
      <span className="text-xs text-zinc-500 shrink-0">
        {match.groupLetter ? `Group ${match.groupLetter}` : ""}
      </span>
    </div>
  );
}

function OpenPoolCard({ pool, me }: { pool: PoolView; me: string | null }) {
  const incomplete = pool.filledCount < 3;
  return (
    <div id={`pool-${pool.id}`} className="scroll-mt-24 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-1">
        <MatchLine pool={pool} />
      </div>
      <div className="mb-3 text-xs text-zinc-600">
        <KickoffTime iso={pool.match.kickoffUtc} />
      </div>
      <OpenBetActions pool={pool} currentManager={me} />
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

// outcome -> FIFA code (DRAW for draw), name fallback. Pots carry match labels
// on the view.
function pariCode(view: PariView, o: Outcome): string {
  const m = view.match;
  if (o === "draw") return "DRAW";
  if (o === "home") return m?.homeCode ?? m?.homeName ?? "HOME";
  return m?.awayCode ?? m?.awayName ?? "AWAY";
}

function PariMatchLine({ view }: { view: PariView }) {
  const m = view.match;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <Link href={`/match/${view.matchId}`} className="flex items-center gap-2 min-w-0 transition hover:text-white">
        <span className="font-mono text-[10px] text-zinc-500 shrink-0">{m?.homeCode ?? "—"}</span>
        <span className="truncate text-zinc-200">{m?.homeName}</span>
        <span className="text-zinc-600 shrink-0">v</span>
        <span className="truncate text-zinc-200">{m?.awayName}</span>
        <span className="font-mono text-[10px] text-zinc-500 shrink-0">{m?.awayCode ?? "—"}</span>
      </Link>
      <span className="text-xs text-zinc-500 shrink-0">{m?.groupLetter ? `Group ${m.groupLetter}` : ""}</span>
    </div>
  );
}

function OpenPariCard({ view }: { view: PariView }) {
  return (
    <div className="rounded-xl border border-amber-500/15 bg-white/[0.02] p-4">
      <div className="mb-1">
        <PariMatchLine view={view} />
      </div>
      <div className="mb-3 flex items-center justify-between text-xs">
        {view.match && <span className="text-zinc-600"><KickoffTime iso={view.match.kickoffUtc} /></span>}
        <span className="tabular-nums text-zinc-300 font-semibold">🍯 ${view.pot}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {OUTCOMES.map((o) => {
          const oc = view.outcomes[o] ?? { total: 0, backers: [] };
          return (
            <div key={o} className="rounded-lg bg-white/[0.03] border border-white/10 p-2 text-[11px]">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="font-mono text-zinc-400">{pariCode(view, o)}</span>
                <span className="tabular-nums text-zinc-500">${oc.total}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {oc.backers.length === 0 ? (
                  <span className="text-[10px] text-zinc-700">—</span>
                ) : (
                  oc.backers.map((b, i) => (
                    <span key={`${b.manager}-${i}`} className="inline-flex items-center rounded bg-white/[0.06] px-1 py-0.5 text-[10px] text-zinc-300">
                      {b.manager} <span className="ml-0.5 tabular-nums text-zinc-500">${b.amount}</span>
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettledPariRow({ view }: { view: PariView }) {
  const result = view.result;
  const winners = result ? view.outcomes[result]?.backers ?? [] : [];
  const refunded = view.status === "void" || winners.length === 0;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <PariMatchLine view={view} />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-500">
          <span className="text-zinc-600">🍯 ${view.pot}</span>
          {result && (
            <>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-300 font-mono">{pariCode(view, result)}</span>
            </>
          )}
        </div>
        {refunded ? (
          <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-zinc-400">Refunded</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5 text-zinc-500">
            {winners.map((w, i) => (
              <MgrChip key={`${w.manager}-${i}`} name={w.manager} />
            ))}
            <span className="text-emerald-400 font-semibold">split it</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Pots({ open, settled }: { open: PariView[]; settled: PariView[] }) {
  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Pots</h2>
      {open.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-500">No open pots. Start one from a match on the home page — one pot per match, closes at kickoff.</p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-600">Pari-mutuel — the winning side splits the whole pot pro-rata. Closes at kickoff.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {open.map((v) => (
              <OpenPariCard key={v.poolId} view={v} />
            ))}
          </div>
        </>
      )}

      {settled.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 text-zinc-500">Settled Pots</h3>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {settled.map((v) => (
              <SettledPariRow key={v.poolId} view={v} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SettleUp({
  ledger,
  settlements,
  myName,
}: {
  ledger: Awaited<ReturnType<typeof getLedger>>;
  settlements: Awaited<ReturnType<typeof getSettlements>>;
  myName: string | null;
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
            {debts.map((d) => (
              <SettleDebtRow
                key={`${d.from}>${d.to}`}
                from={d.from}
                to={d.to}
                amount={d.amount}
                myName={myName}
              />
            ))}
          </ul>
        )}
      </div>

      {debts.length > 0 && (
        <p className="mt-2 text-[11px] text-zinc-600">
          We don&apos;t store Venmo usernames yet — the Venmo link opens with the amount filled in, then you pick the person you owe.
        </p>
      )}

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 text-zinc-500">Payments</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          {settlements.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No payments logged yet. Once someone marks a debt paid, it shows up here for the other side to confirm.
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {settlements.map((s) => (
                <SettlementRow
                  key={s.id}
                  id={s.id}
                  from={s.from}
                  to={s.to}
                  amount={s.amount}
                  ackStatus={s.ackStatus}
                  payerAckAt={s.payerAckAt}
                  payeeAckAt={s.payeeAckAt}
                  createdAt={s.createdAt}
                  note={s.note}
                  myName={myName}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

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
  let current: Awaited<ReturnType<typeof getCurrentManager>> = null;
  try {
    current = await getCurrentManager();
  } catch {
    current = null;
  }
  const me = current?.manager ?? null;

  const [ledger, { open, settled }, pari, settlements] = await Promise.all([
    getLedger(),
    getAllPoolViews(),
    getAllPariViews(current?.personId),
    getSettlements(),
  ]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Bets</h1>
        <p className="text-zinc-500 text-sm mt-1">
          The three-spot pool — who owes whom, what&apos;s still open, and how it all shook out.
        </p>
      </div>

      <AutoBetPanel />

      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Open Bets</h2>
        {open.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-zinc-500">No open bets right now. Start one from a match on the home page.</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-zinc-600">Take an open spot to join a bet.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {open.map((p) => (
                <OpenPoolCard key={p.id} pool={p} me={me} />
              ))}
            </div>
          </>
        )}
      </section>

      <Pots open={pari.open} settled={pari.settled} />

      <SettleUp ledger={ledger} settlements={settlements} myName={me} />

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
