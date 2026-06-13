import { getStandings, rivalryHeadline, type H2HCell } from "@/lib/standings";
import { styleFor } from "@/lib/managers";
import { ManagersTable } from "@/components/ManagersTable";

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

export default async function HeadToHeadPage() {
  const { table, managers, h2h, rivalries } = await getStandings();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Head to Head</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Who&apos;s beaten whom. Built from finished matches — a manager&apos;s teams vs the field.
        </p>
      </div>

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
}
