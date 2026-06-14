import Link from "next/link";
import { getRosters, getAllTeams } from "@/lib/queries";
import type { ManagerRoster, RosterTeam, TeamRow } from "@/lib/queries";
import { MANAGERS, styleFor } from "@/lib/managers";
import { OwnerChip } from "@/components/OwnerChip";
import { Tabs } from "@/components/Tabs";

export const dynamic = "force-dynamic";

// ── By Manager helpers (from app/managers/page.tsx) ──────────────────────────

function byRound(a: RosterTeam, b: RosterTeam) {
  const ar = a.draftRound ?? Number.POSITIVE_INFINITY;
  const br = b.draftRound ?? Number.POSITIVE_INFINITY;
  return ar - br;
}

function RosterTeamRow({ team }: { team: RosterTeam }) {
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
          <RosterTeamRow key={t.name} team={t} />
        ))}
      </div>
    </Link>
  );
}

function ByManager({ rosters }: { rosters: ManagerRoster[] }) {
  const order = (m: string) => {
    const i = (MANAGERS as readonly string[]).indexOf(m);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const sorted = [...rosters].sort((a, b) => order(a.manager) - order(b.manager));

  if (sorted.length === 0) {
    return <p className="text-sm text-zinc-600">No rosters drafted yet.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sorted.map((r) => (
        <ManagerCard key={r.manager} roster={r} />
      ))}
    </div>
  );
}

// ── By Group helpers (from app/teams/page.tsx) ───────────────────────────────

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

function ByGroup({ teams }: { teams: TeamRow[] }) {
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
      <p className="text-zinc-500 text-sm mb-4">
        All {teams.length} teams — {drafted} drafted, {freeAgents} free agents.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {orderedGroups.map(([letter, groupTeams]) => (
          <GroupCard key={letter} letter={letter} teams={groupTeams} />
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DraftPage() {
  const [rosters, teams] = await Promise.all([getRosters(), getAllTeams()]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Draft</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Who drafted whom — by manager or by group.
        </p>
      </div>

      <Tabs
        tabs={[
          { label: "By Manager", content: <ByManager rosters={rosters} /> },
          { label: "By Group", content: <ByGroup teams={teams} /> },
        ]}
      />
    </div>
  );
}
