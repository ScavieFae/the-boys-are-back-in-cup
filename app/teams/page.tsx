import { getAllTeams } from "@/lib/queries";
import { OwnerChip } from "@/components/OwnerChip";
import type { TeamRow } from "@/lib/queries";

export const dynamic = "force-dynamic";

function TeamRowItem({ team }: { team: TeamRow }) {
  const drafted = team.draftRound != null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="font-mono text-[10px] text-zinc-500 w-8 shrink-0">{team.code ?? "—"}</span>
        <span className={`truncate ${drafted ? "text-zinc-200" : "text-zinc-500"}`}>{team.name}</span>
        <OwnerChip owner={team.owner} />
      </div>
      {drafted && (
        <span className="font-mono text-[10px] text-zinc-500 rounded bg-white/5 px-1.5 py-0.5 leading-none shrink-0">
          R{team.draftRound}
        </span>
      )}
    </div>
  );
}

function GroupCard({ letter, teams }: { letter: string; teams: TeamRow[] }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-2">
        Group {letter}
      </h2>
      <div className="divide-y divide-white/5">
        {teams.map((t) => (
          <TeamRowItem key={t.name} team={t} />
        ))}
      </div>
    </section>
  );
}

export default async function TeamsPage() {
  const teams = await getAllTeams();

  const drafted = teams.filter((t) => t.owner != null).length;
  const freeAgents = teams.length - drafted;

  // Group by groupLetter, alphabetical group order. Teams already arrive
  // ordered by group then name from getAllTeams().
  const groups = new Map<string, TeamRow[]>();
  for (const t of teams) {
    const letter = t.groupLetter ?? "—";
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(t);
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Teams</h1>
        <p className="text-zinc-500 text-sm mt-1">
          All {teams.length} teams — {drafted} drafted, {freeAgents} free agents.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {orderedGroups.map(([letter, groupTeams]) => (
          <GroupCard key={letter} letter={letter} teams={groupTeams} />
        ))}
      </div>
    </div>
  );
}
