import { getStats, type TeamStat } from "@/lib/stats";
import { OwnerChip } from "@/components/OwnerChip";
import { styleFor } from "@/lib/managers";

export const dynamic = "force-dynamic";

function TeamLine({ t, metric }: { t: TeamStat; metric: "goals" | "reds" }) {
  const value = metric === "goals" ? t.goals : t.reds;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="font-mono text-[10px] text-zinc-500 w-8 shrink-0">{t.code ?? "—"}</span>
        <span className="truncate text-zinc-200">{t.team}</span>
        <OwnerChip owner={t.owner} />
      </div>
      <span className="tabular-nums font-semibold shrink-0">
        {metric === "reds" ? `${value} 🟥` : value}
      </span>
    </div>
  );
}

export default async function StatsPage() {
  const { teams, managers, totalGoals, totalReds } = await getStats();

  const scorers = teams.filter((t) => t.goals > 0); // already sorted by goals desc
  const carded = teams.filter((t) => t.reds > 0).sort((a, b) => b.reds - a.reds);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Stats</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {totalGoals} goals and {totalReds} red card{totalReds === 1 ? "" : "s"} so far — by team, totted up by manager.
        </p>
      </div>

      {/* By manager */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">By Manager</h2>
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs border-b border-white/10">
                <th className="text-left font-medium px-4 py-2.5">Manager</th>
                <th className="text-right font-medium px-3 py-2.5">Goals</th>
                <th className="text-right font-medium px-4 py-2.5">Red Cards</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m) => {
                const s = styleFor(m.manager);
                return (
                  <tr key={m.manager} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
                        {m.manager}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{m.goals}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{m.reds > 0 ? `${m.reds} 🟥` : "0"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Goals by team */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Goals by Team</h2>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 divide-y divide-white/5">
            {scorers.length === 0 ? (
              <p className="text-sm text-zinc-600">No goals scored yet.</p>
            ) : (
              scorers.map((t) => <TeamLine key={t.team} t={t} metric="goals" />)
            )}
          </div>
        </section>

        {/* Red cards by team */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Red Cards by Team</h2>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 divide-y divide-white/5">
            {carded.length === 0 ? (
              <p className="text-sm text-zinc-600">No red cards yet — give it time.</p>
            ) : (
              carded.map((t) => <TeamLine key={t.team} t={t} metric="reds" />)
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
