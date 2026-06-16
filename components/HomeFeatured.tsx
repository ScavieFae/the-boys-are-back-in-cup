"use client";

import { useState } from "react";
import type { MatchView } from "@/lib/queries";
import type { PoolView, MatchAction } from "@/lib/bets";
import { defaultFeaturedId } from "@/lib/featured";
import { OwnerChip } from "./OwnerChip";
import { KickoffTime } from "./KickoffTime";
import { BroadcastBadge } from "./BroadcastBadge";
import { MatchBetting } from "./MatchBetting";

// Props are all serializable: Maps are converted to plain objects in page.tsx
// before crossing the server/client boundary.
export interface HomeFeaturedProps {
  live: MatchView[];
  upcoming: MatchView[];
  recent: MatchView[];
  poolsByMatch: Record<number, PoolView[]>;
  actionsByMatch: Record<number, MatchAction | null>;
  currentManager: string | null;
}

function betMatchFrom(m: MatchView) {
  return {
    id: m.id,
    homeName: m.home.name,
    homeCode: m.home.code,
    awayName: m.away.name,
    awayCode: m.away.code,
    status: m.status,
    odds: m.odds ? { home: m.odds.home, draw: m.odds.draw, away: m.odds.away } : null,
  };
}

function HeroSide({
  name,
  code,
  owner,
  score,
  showScore,
  winner,
}: {
  name: string;
  code: string | null;
  owner: string | null;
  score: number | null;
  showScore: boolean;
  winner: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-mono text-xs text-zinc-500 w-10 shrink-0">{code ?? "—"}</span>
        <span className={`truncate text-lg sm:text-xl ${winner ? "font-bold text-white" : "font-semibold text-zinc-100"}`}>
          {name}
        </span>
        <OwnerChip owner={owner} />
      </div>
      {showScore && (
        <span className={`tabular-nums text-4xl sm:text-5xl leading-none ${winner ? "font-bold text-white" : "font-semibold text-zinc-300"}`}>
          {score ?? 0}
        </span>
      )}
    </div>
  );
}

function HeroEyebrow({ match, isSoonestUpcoming }: { match: MatchView; isSoonestUpcoming: boolean }) {
  const isLive = match.status === "in";
  const isFinal = match.status === "post";

  if (isLive) {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-red-400">
        <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
        {match.statusDetail || "LIVE"}
      </span>
    );
  }
  if (isFinal) {
    return <span className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Final</span>;
  }
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="font-semibold uppercase tracking-wider text-emerald-400">
        {isSoonestUpcoming ? "Next game" : "Upcoming"}
      </span>
      <span className="text-zinc-400">
        <KickoffTime iso={match.kickoffUtc} />
      </span>
    </span>
  );
}

function HeroCard({
  match,
  pools,
  isSoonestUpcoming,
  currentManager,
}: {
  match: MatchView;
  pools: PoolView[];
  isSoonestUpcoming: boolean;
  currentManager: string | null;
}) {
  const isLive = match.status === "in";
  const isFinal = match.status === "post";
  const showScore = isLive || isFinal;

  const hs = match.home.score ?? 0;
  const as = match.away.score ?? 0;
  const homeWin = isFinal && hs > as;
  const awayWin = isFinal && as > hs;

  const showOdds = match.odds && !isLive;
  const showBetting = match.status !== "post" || pools.length > 0;

  return (
    <div
      className={`rounded-2xl border p-5 sm:p-6 ${
        isLive ? "border-red-500/40 bg-red-500/[0.05]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3 text-xs">
        <span className="text-zinc-500">
          {match.groupLetter ? `Group ${match.groupLetter}` : match.stage ?? ""}
        </span>
        <HeroEyebrow match={match} isSoonestUpcoming={isSoonestUpcoming} />
      </div>

      <div className="border-t border-white/10 pt-2">
        <HeroSide {...match.home} showScore={showScore} winner={homeWin} />
        <HeroSide {...match.away} showScore={showScore} winner={awayWin} />
      </div>

      {match.broadcast && (
        <div className="mt-2">
          <BroadcastBadge broadcast={match.broadcast} watchUrl={match.watchUrl} live={isLive} />
        </div>
      )}

      {showOdds && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-zinc-500">
          <span className="uppercase tracking-wide text-zinc-600">
            {isFinal ? "Closing odds" : "Odds"}
          </span>
          <span>{match.home.code ?? "H"} <span className="text-zinc-200">{match.odds!.home ?? "—"}</span></span>
          <span>Draw <span className="text-zinc-200">{match.odds!.draw ?? "—"}</span></span>
          <span>{match.away.code ?? "A"} <span className="text-zinc-200">{match.odds!.away ?? "—"}</span></span>
          {match.odds!.provider && <span className="text-zinc-700 ml-auto">{match.odds!.provider}</span>}
        </div>
      )}

      {showBetting && (
        <MatchBetting match={betMatchFrom(match)} pools={pools} currentManager={currentManager} />
      )}
    </div>
  );
}

function LiveStripCard({
  match,
  active,
  onClick,
}: {
  match: MatchView;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 w-44 text-left rounded-xl border p-3 transition ${
        active ? "border-red-500/60 bg-red-500/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold text-red-400">
        <span className="live-dot inline-block h-2 w-2 rounded-full bg-red-500" />
        {match.statusDetail || "LIVE"}
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-mono text-xs text-zinc-400 truncate">{match.home.code ?? match.home.name}</span>
        <span className="tabular-nums font-bold text-white">{match.home.score ?? 0}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-mono text-xs text-zinc-400 truncate">{match.away.code ?? match.away.name}</span>
        <span className="tabular-nums font-bold text-white">{match.away.score ?? 0}</span>
      </div>
    </button>
  );
}

export function HomeFeatured({
  live,
  upcoming,
  recent,
  poolsByMatch,
  currentManager,
}: HomeFeaturedProps) {
  const [featuredId, setFeaturedId] = useState<number | null>(() =>
    defaultFeaturedId(live, upcoming, recent),
  );

  const all = [...live, ...upcoming, ...recent];
  const featured = all.find((m) => m.id === featuredId) ?? null;

  // The strip: all live games except the featured one. If the user featured a
  // non-live game while games are live, still show all live games so live
  // action is never hidden.
  const featuredIsLive = featured?.status === "in";
  const stripGames = featuredIsLive ? live.filter((m) => m.id !== featuredId) : live;

  if (!featured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-zinc-500">
        No matches yet.
      </div>
    );
  }

  const isSoonestUpcoming = featured.status === "pre" && featured.id === upcoming[0]?.id;

  return (
    <div>
      <HeroCard
        match={featured}
        pools={poolsByMatch[featured.id] ?? []}
        isSoonestUpcoming={isSoonestUpcoming}
        currentManager={currentManager}
      />

      {stripGames.length > 0 && (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
          {stripGames.map((m) => (
            <LiveStripCard
              key={m.id}
              match={m}
              active={m.id === featuredId}
              onClick={() => setFeaturedId(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
