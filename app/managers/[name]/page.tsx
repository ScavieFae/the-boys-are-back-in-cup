import Link from "next/link";
import { notFound } from "next/navigation";
import { getRosters } from "@/lib/queries";
import type { RosterTeam } from "@/lib/queries";
import { styleFor } from "@/lib/managers";

export const dynamic = "force-dynamic";

function byRound(a: RosterTeam, b: RosterTeam) {
  const ar = a.draftRound ?? Number.POSITIVE_INFINITY;
  const br = b.draftRound ?? Number.POSITIVE_INFINITY;
  return ar - br;
}

export default async function ManagerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const manager = decodeURIComponent(name);

  const rosters = await getRosters();
  const roster = rosters.find((r) => r.manager === manager);
  if (!roster) notFound();

  const s = styleFor(roster.manager);
  const teams = [...roster.teams].sort(byRound);

  return (
    <div>
      <Link
        href="/managers"
        className="inline-block text-sm text-zinc-500 hover:text-white transition mb-6"
      >
        ← All managers
      </Link>

      <div className="mb-8 flex items-center gap-3">
        <span className={`inline-block h-4 w-4 rounded-full ${s.bar}`} />
        <h1 className="text-2xl font-bold tracking-tight">
          Who&rsquo;s on{" "}
          <span className={`rounded-md px-2 py-0.5 ${s.chip}`}>{roster.manager}</span>
          &rsquo;s team
        </h1>
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-3">
        {teams.length} teams drafted
      </h2>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {teams.map((t) => (
          <div key={t.name} className="flex items-center gap-3 px-4 py-2.5">
            <span className="font-mono text-[10px] text-zinc-500 w-8 shrink-0">
              {t.draftRound != null ? `R${t.draftRound}` : "—"}
            </span>
            <span className="font-mono text-[10px] text-zinc-500 w-8 shrink-0">{t.code ?? "—"}</span>
            <span className="truncate text-zinc-200">{t.name}</span>
            <span className="ml-auto text-xs text-zinc-500 shrink-0">
              {t.groupLetter ? `Grp ${t.groupLetter}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
