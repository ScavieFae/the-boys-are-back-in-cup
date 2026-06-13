import type { TableRow } from "@/lib/standings";
import { styleFor } from "@/lib/managers";

function ManagerName({ name }: { name: string }) {
  const s = styleFor(name);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
      {name}
    </span>
  );
}

export function ManagersTable({ table }: { table: TableRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-zinc-500 text-xs border-b border-white/10">
            <th className="text-left font-medium px-4 py-2.5">#</th>
            <th className="text-left font-medium px-2 py-2.5">Manager</th>
            {["P", "W", "D", "L", "GF", "GA", "GD", "Pts"].map((h) => (
              <th key={h} className="text-right font-medium px-2 py-2.5 tabular-nums">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.map((r, i) => (
            <tr key={r.manager} className="border-b border-white/5 last:border-0">
              <td className="px-4 py-2.5 text-zinc-500 tabular-nums">{i + 1}</td>
              <td className="px-2 py-2.5"><ManagerName name={r.manager} /></td>
              <td className="px-2 py-2.5 text-right tabular-nums text-zinc-400">{r.played}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{r.w}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-zinc-400">{r.d}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-zinc-400">{r.l}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-zinc-400">{r.gf}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-zinc-400">{r.ga}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-zinc-400">
                {r.gd > 0 ? `+${r.gd}` : r.gd}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
