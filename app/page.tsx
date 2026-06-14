import Link from "next/link";
import { getHomepageMatches } from "@/lib/queries";
import { getStandings } from "@/lib/standings";
import { getAllPoolViews, type PoolView } from "@/lib/bets";
import { getCurrentManager } from "@/lib/auth-guard";
import { MatchCard } from "@/components/MatchCard";
import { MatchBetting } from "@/components/MatchBetting";
import { ManagersTable } from "@/components/ManagersTable";
import { AutoRefresh } from "@/components/AutoRefresh";
import type { MatchView } from "@/lib/queries";

export const dynamic = "force-dynamic";

function CardWithBetting({
  m,
  pools,
  currentManager,
}: {
  m: MatchView;
  pools: PoolView[];
  currentManager: string | null;
}) {
  const showBetting = m.status === "pre" || pools.length > 0;
  return (
    <div>
      <MatchCard match={m} />
      {showBetting && (
        <MatchBetting
          match={{
            id: m.id,
            homeName: m.home.name,
            homeCode: m.home.code,
            awayName: m.away.name,
            awayCode: m.away.code,
            status: m.status,
            odds: m.odds ? { home: m.odds.home, draw: m.odds.draw, away: m.odds.away } : null,
          }}
          pools={pools}
          currentManager={currentManager}
        />
      )}
    </div>
  );
}

function Section({
  title,
  accent,
  matches,
  empty,
  poolsByMatch,
  currentManager,
}: {
  title: string;
  accent?: string;
  matches: MatchView[];
  empty: string;
  poolsByMatch: Map<number, PoolView[]>;
  currentManager: string | null;
}) {
  return (
    <section className="mb-10">
      <h2 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${accent ?? "text-zinc-400"}`}>
        {title}
      </h2>
      {matches.length === 0 ? (
        <p className="text-sm text-zinc-600">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 items-start">
          {matches.map((m) => (
            <CardWithBetting
              key={m.id}
              m={m}
              pools={poolsByMatch.get(m.id) ?? []}
              currentManager={currentManager}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function Home() {
  const [{ live, recent, upcoming }, standings, poolViews, me] = await Promise.all([
    getHomepageMatches(),
    getStandings(),
    getAllPoolViews(),
    getCurrentManager(),
  ]);

  const poolsByMatch = new Map<number, PoolView[]>();
  for (const p of poolViews.open) {
    if (!poolsByMatch.has(p.matchId)) poolsByMatch.set(p.matchId, []);
    poolsByMatch.get(p.matchId)!.push(p);
  }
  const currentManager = me?.manager ?? null;

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
        poolsByMatch={poolsByMatch}
        currentManager={currentManager}
      />
      <Section
        title="Recently Finished"
        matches={recent}
        empty="No results in yet."
        poolsByMatch={poolsByMatch}
        currentManager={currentManager}
      />
      <Section
        title="Upcoming (next 4)"
        matches={upcoming}
        empty="No upcoming fixtures scheduled."
        poolsByMatch={poolsByMatch}
        currentManager={currentManager}
      />

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
