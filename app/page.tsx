import Link from "next/link";
import { getHomepageMatches } from "@/lib/queries";
import { getStandings } from "@/lib/standings";
import { freshenIfStale } from "@/lib/sync";
import { getAllPoolViews, getMatchActions, type PoolView, type MatchAction } from "@/lib/bets";
import { getCurrentManager } from "@/lib/auth-guard";
import { CardWithBetting } from "@/components/CardWithBetting";
import { ManagersTable } from "@/components/ManagersTable";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FeedRail } from "@/components/FeedRail";
import { HomeFeatured } from "@/components/HomeFeatured";
import { defaultFeaturedId } from "@/lib/featured";
import { getFeed } from "@/lib/feed";
import type { MatchView } from "@/lib/queries";

export const dynamic = "force-dynamic";

function Section({
  title,
  matches,
  empty,
  poolsByMatch,
  actionsByMatch,
  currentManager,
}: {
  title: string;
  matches: MatchView[];
  empty: string;
  poolsByMatch: Record<number, PoolView[]>;
  actionsByMatch: Record<number, MatchAction | null>;
  currentManager: string | null;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">
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
              pools={poolsByMatch[m.id] ?? []}
              action={actionsByMatch[m.id] ?? null}
              currentManager={currentManager}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function Home() {
  // Keep live scores current while someone's watching (cron is throttled).
  await freshenIfStale();

  const [{ live, recent, upcoming }, standings, poolViews, actionsMap, me, feed] = await Promise.all([
    getHomepageMatches(),
    getStandings(),
    getAllPoolViews(),
    getMatchActions(),
    getCurrentManager(),
    getFeed(8),
  ]);

  // Maps are NOT serializable across the server/client boundary, so build plain
  // objects keyed by match id before passing to <HomeFeatured> (and reuse them
  // for the server-rendered grids below).
  const poolsByMatch: Record<number, PoolView[]> = {};
  for (const p of poolViews.open) {
    (poolsByMatch[p.matchId] ??= []).push(p);
  }
  const actionsByMatch: Record<number, MatchAction | null> = {};
  for (const [id, a] of actionsMap) actionsByMatch[id] = a;

  const currentManager = me?.manager ?? null;

  // The hero's default feature. If it's an upcoming game (i.e. there are no live
  // games), drop it from the Upcoming grid so it isn't shown twice. With live
  // games present, the default feature is a live game and the full upcoming
  // slate renders. (Click-to-feature can later move a game into the hero while
  // it still shows in the grid — that momentary dupe is acceptable per spec.)
  const featuredDefaultId = defaultFeaturedId(live, upcoming, recent);
  const upcomingForGrid =
    live.length === 0 && upcoming.length > 0 && upcoming[0].id === featuredDefaultId
      ? upcoming.slice(1)
      : upcoming;

  return (
    <div>
      <AutoRefresh seconds={live.length > 0 ? 20 : 60} />

      <div className="mb-8 flex flex-col lg:flex-row gap-4">
        <div className="lg:flex-[3] min-w-0">
          <HomeFeatured
            live={live}
            upcoming={upcoming}
            recent={recent}
            poolsByMatch={poolsByMatch}
            actionsByMatch={actionsByMatch}
            currentManager={currentManager}
          />
        </div>
        <div className="lg:flex-[2] min-w-0">
          <FeedRail items={feed} currentManager={currentManager} showSeeAll />
        </div>
      </div>

      <Section
        title="Upcoming"
        matches={upcomingForGrid}
        empty="No upcoming fixtures scheduled."
        poolsByMatch={poolsByMatch}
        actionsByMatch={actionsByMatch}
        currentManager={currentManager}
      />
      <Section
        title="Recently Finished"
        matches={recent}
        empty="No results in yet."
        poolsByMatch={poolsByMatch}
        actionsByMatch={actionsByMatch}
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
