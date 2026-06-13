import Link from "next/link";
import { getHomepageMatches } from "@/lib/queries";
import { getStandings } from "@/lib/standings";
import { MatchCard } from "@/components/MatchCard";
import { ManagersTable } from "@/components/ManagersTable";
import { AutoRefresh } from "@/components/AutoRefresh";
import type { MatchView } from "@/lib/queries";

export const dynamic = "force-dynamic";

function Section({
  title,
  accent,
  matches,
  empty,
}: {
  title: string;
  accent?: string;
  matches: MatchView[];
  empty: string;
}) {
  return (
    <section className="mb-10">
      <h2 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${accent ?? "text-zinc-400"}`}>
        {title}
      </h2>
      {matches.length === 0 ? (
        <p className="text-sm text-zinc-600">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function Home() {
  const [{ live, recent, upcoming }, standings] = await Promise.all([
    getHomepageMatches(),
    getStandings(),
  ]);

  return (
    <div>
      <AutoRefresh seconds={live.length > 0 ? 20 : 60} />

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          {live.length > 0 ? "Live right now" : "Now Playing"}
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Every match, with the manager who drafted each side. $10 a man, winner takes the pot.
        </p>
      </div>

      <Section
        title="● Live"
        accent="text-red-400"
        matches={live}
        empty="Nothing kicking off this second — check the upcoming slate below."
      />
      <Section title="Recently Finished" matches={recent} empty="No results in yet." />
      <Section title="Upcoming (next 4)" matches={upcoming} empty="No upcoming fixtures scheduled." />

      <section className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Managers&apos; Table
          </h2>
          <Link href="/head-to-head" className="text-xs text-zinc-400 hover:text-white transition">
            Full head-to-head →
          </Link>
        </div>
        <ManagersTable table={standings.table} />
      </section>
    </div>
  );
}
