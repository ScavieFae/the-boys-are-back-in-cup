import Link from "next/link";
import { getMatchById } from "@/lib/queries";
import { getOpenPoolsForMatch, getAllPoolViews, getMatchActions } from "@/lib/bets";
import { getPariView } from "@/lib/parimutuel";
import { getCurrentManager } from "@/lib/auth-guard";
import { getFeedForMatch } from "@/lib/feed";
import { MatchCard } from "@/components/MatchCard";
import { MatchBetting } from "@/components/MatchBetting";
import { PariPot } from "@/components/PariPot";
import { FeedRail } from "@/components/FeedRail";

export const dynamic = "force-dynamic";

function NotFound() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
      <h1 className="text-xl font-bold tracking-tight">Match not found</h1>
      <p className="mt-1 text-sm text-zinc-500">
        That fixture doesn&apos;t exist — it may have been removed.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-md bg-white/[0.06] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10"
      >
        ← Back to Now Playing
      </Link>
    </div>
  );
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isInteger(matchId) || matchId <= 0) return <NotFound />;

  const me = await getCurrentManager();

  const [match, openPools, allPools, actionsMap, pari, feed] = await Promise.all([
    getMatchById(matchId),
    getOpenPoolsForMatch(matchId),
    getAllPoolViews(),
    getMatchActions(),
    getPariView(matchId, me?.personId),
    getFeedForMatch(matchId),
  ]);

  if (!match) return <NotFound />;

  const currentManager = me?.manager ?? null;
  const action = actionsMap.get(matchId) ?? null;
  const settledPools = allPools.settled.filter((p) => p.matchId === matchId);

  // Same betting-shape projection CardWithBetting / HomeFeatured use.
  const betMatch = {
    id: match.id,
    homeName: match.home.name,
    homeCode: match.home.code,
    awayName: match.away.name,
    awayCode: match.away.code,
    status: match.status,
    odds: match.odds ? { home: match.odds.home, draw: match.odds.draw, away: match.odds.away } : null,
  };

  const showBetting = match.status !== "post" || openPools.length > 0;
  const showPari = match.status === "pre" || (pari?.pot ?? 0) > 0;

  return (
    <div>
      <div className="mb-6">
        <Link href="/" className="text-xs text-zinc-500 transition hover:text-zinc-300">
          ← Now Playing
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          {match.home.name} <span className="text-zinc-600">v</span> {match.away.name}
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-start">
        <div className="space-y-6">
          {/* Header card: score + odds at a glance, plus the full betting + pot
              controls. MatchCard renders the informational region (no href here —
              we're already on the match page); the betting slot carries the
              interactive controls. */}
          <MatchCard
            match={match}
            action={action}
            betting={
              <>
                {showBetting && (
                  <MatchBetting match={betMatch} pools={openPools} currentManager={currentManager} />
                )}
                {showPari && (
                  <PariPot
                    view={pari}
                    matchId={match.id}
                    matchStatus={match.status}
                    homeCode={match.home.code}
                    awayCode={match.away.code}
                    homeName={match.home.name}
                    awayName={match.away.name}
                    currentManager={currentManager}
                  />
                )}
              </>
            }
          />

          {settledPools.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Settled bets
              </h2>
              <div className="space-y-2">
                {settledPools.map((p) => {
                  const result = p.result;
                  const winningSpot = result ? p.spots[result] : null;
                  const isPush = result != null && (winningSpot == null || winningSpot.manager == null);
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm"
                    >
                      <span className="text-zinc-500">
                        {result ? (
                          <>
                            result{" "}
                            <span className="text-zinc-300">
                              {result === "home" ? p.match.homeName : result === "away" ? p.match.awayName : "Draw"}
                            </span>
                          </>
                        ) : (
                          "settled"
                        )}
                      </span>
                      {isPush ? (
                        <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs text-zinc-400">Push</span>
                      ) : winningSpot?.manager ? (
                        <span className="text-xs text-zinc-500">
                          <span className="text-zinc-300">{winningSpot.manager}</span>{" "}
                          <span className="font-semibold text-emerald-400">won</span>
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <FeedRail items={feed} currentManager={currentManager} title="Match activity" showSeeAll={false} />
      </div>
    </div>
  );
}
