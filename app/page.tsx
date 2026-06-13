import { getHomepageMatches } from "@/lib/queries";
import { MatchCard } from "@/components/MatchCard";
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
  const { live, recent, upcoming } = await getHomepageMatches();

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
      <Section title="Upcoming" matches={upcoming} empty="No upcoming fixtures scheduled." />
    </div>
  );
}
