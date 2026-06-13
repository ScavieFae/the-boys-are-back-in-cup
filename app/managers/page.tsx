import Link from "next/link";
import { getRosters } from "@/lib/queries";
import type { ManagerRoster, RosterTeam } from "@/lib/queries";
import { MANAGERS, styleFor } from "@/lib/managers";

export const dynamic = "force-dynamic";

function byRound(a: RosterTeam, b: RosterTeam) {
  const ar = a.draftRound ?? Number.POSITIVE_INFINITY;
  const br = b.draftRound ?? Number.POSITIVE_INFINITY;
  return ar - br;
}

function TeamRow({ team }: { team: RosterTeam }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="font-mono text-[10px] text-zinc-500 w-7 shrink-0">
        {team.draftRound != null ? `R${team.draftRound}` : "—"}
      </span>
      <span className="font-mono text-[10px] text-zinc-500 w-8 shrink-0">{team.code ?? "—"}</span>
      <span className="truncate text-zinc-200">{team.name}</span>
      <span className="ml-auto text-xs text-zinc-500 shrink-0">
        {team.groupLetter ? `Grp ${team.groupLetter}` : ""}
      </span>
    </div>
  );
}

function ManagerCard({ roster }: { roster: ManagerRoster }) {
  const s = styleFor(roster.manager);
  const teams = [...roster.teams].sort(byRound);
  return (
    <Link
      href={`/managers/${encodeURIComponent(roster.manager)}`}
      className="rounded-xl border border-white/10 bg-white/[0.02] p-4 block hover:border-white/20 hover:bg-white/[0.04] transition"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2">
          <span className={`inline-block h-3 w-3 rounded-full ${s.bar}`} />
          <span className="text-lg font-bold tracking-tight text-white">{roster.manager}</span>
        </h2>
        <span className="text-xs text-zinc-500">{teams.length} teams</span>
      </div>
      <div className="divide-y divide-white/5">
        {teams.map((t) => (
          <TeamRow key={t.name} team={t} />
        ))}
      </div>
    </Link>
  );
}

export default async function ManagersPage() {
  const rosters = await getRosters();
  const order = (m: string) => {
    const i = (MANAGERS as readonly string[]).indexOf(m);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const sorted = [...rosters].sort((a, b) => order(a.manager) - order(b.manager));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Managers</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Every manager and the eight teams they drafted. $10 a man, winner takes the pot.
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-zinc-600">No rosters drafted yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sorted.map((r) => (
            <ManagerCard key={r.manager} roster={r} />
          ))}
        </div>
      )}
    </div>
  );
}
