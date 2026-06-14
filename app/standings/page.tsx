import { getStandings, rivalryHeadline, type H2HCell } from "@/lib/standings";
import { getStats, type TeamStat } from "@/lib/stats";
import { getBetStats } from "@/lib/bets";
import { styleFor } from "@/lib/managers";
import { OwnerChip } from "@/components/OwnerChip";
import { ManagersTable } from "@/components/ManagersTable";
import { Tabs } from "@/components/Tabs";

export const dynamic = "force-dynamic";

function ManagerName({ name, className = "" }: { name: string; className?: string }) {
  const s = styleFor(name);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip} ${className}`}>
      {name}
    </span>
  );
}

function cellText(c: H2HCell): { text: string; tone: string } {
  const played = c.w + c.d + c.l;
  if (played === 0) return { text: "·", tone: "text-zinc-700" };
  const tone = c.w > c.l ? "text-emerald-400" : c.l > c.w ? "text-red-400" : "text-zinc-300";
  return { text: `${c.w}-${c.d}-${c.l}`, tone };
}

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default async function StandingsPage() {
  const [standings, stats, bets] = await Promise.all([
    getStandings(),
    getStats(),
    getBetStats(),
  ]);

  const { table, managers, h2h, rivalries } = standings;
  const { teams, managers: statManagers } = stats;

  const scorers = teams.filter((t) => t.goals > 0); // already sorted by goals desc
  const carded = teams.filter((t) => t.reds > 0).sort((a, b) => b.reds - a.reds);

  const standingsTab = (
    <div>
      {/* League table */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">
          Managers&apos; Table
        </h2>
        <ManagersTable table={table} />
        <p className="text-xs text-zinc-600 mt-2">
          3 points a win, 1 a draw. Counts every finished match a manager&apos;s teams played, free agents included.
        </p>
      </section>

      {/* H2H matrix */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">
          Head-to-Head Grid
        </h2>
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02] p-2">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-2 py-2 text-left text-xs text-zinc-600 font-medium">vs →</th>
                {managers.map((m) => (
                  <th key={m} className="px-2 py-2 text-center"><ManagerName name={m} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {managers.map((row) => (
                <tr key={row}>
                  <td className="px-2 py-2"><ManagerName name={row} /></td>
                  {managers.map((col) => {
                    if (row === col) {
                      return <td key={col} className="px-2 py-2 text-center text-zinc-700">—</td>;
                    }
                    const { text, tone } = cellText(h2h[row][col]);
                    return (
                      <td key={col} className={`px-2 py-2 text-center tabular-nums ${tone}`}>{text}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Each cell is the row manager&apos;s record vs the column (W-D-L). Green = ahead, red = behind.
        </p>
      </section>

      {/* Rivalries */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Rivalries</h2>
        {rivalries.length === 0 ? (
          <p className="text-sm text-zinc-600">
            No manager-vs-manager games have finished yet — check back once more group games wrap.
          </p>
        ) : (
          <ul className="space-y-2">
            {rivalries.map((r) => (
              <li
                key={`${r.a}|${r.b}`}
                className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm flex items-center justify-between gap-3"
              >
                <span>{rivalryHeadline(r)}</span>
                <span className="text-xs text-zinc-600 tabular-nums shrink-0">
                  {r.meetings} game{r.meetings > 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  const statsTab = (
    <div>
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
              {statManagers.map((m) => {
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

      {/* Betting */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Betting</h2>
        {bets.totalBets === 0 && bets.openBets === 0 ? (
          <p className="text-sm text-zinc-600">No bets placed yet — start one from a match on the home page.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Bets settled" value={String(bets.totalBets)} />
              <Stat label="Open now" value={String(bets.openBets)} />
              <Stat label="Total wagered" value={`$${bets.totalWagered}`} />
              <Stat label="Biggest pot" value={`$${bets.biggestPot}`} />
              <Stat label="Pushes" value={String(bets.pushes)} />
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-xs text-zinc-500 mb-2">Most-bet matches</div>
              {bets.mostBetMatches.length === 0 ? (
                <p className="text-sm text-zinc-600">—</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {bets.mostBetMatches.map((mb) => (
                    <div key={mb.label} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="truncate text-zinc-200">{mb.label}</span>
                      <span className="tabular-nums text-zinc-400 shrink-0">{mb.count} bet{mb.count > 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Standings</h1>
        <p className="text-zinc-500 text-sm mt-1">
          The table, head-to-head records, and the numbers behind them — all in one place.
        </p>
      </div>

      <Tabs
        tabs={[
          { label: "Standings", content: standingsTab },
          { label: "Stats", content: statsTab },
        ]}
      />
    </div>
  );
}
