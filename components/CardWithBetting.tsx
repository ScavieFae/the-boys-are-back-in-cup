import { MatchCard } from "@/components/MatchCard";
import { MatchBetting } from "@/components/MatchBetting";
import { PariPot } from "@/components/PariPot";
import type { MatchView } from "@/lib/queries";
import type { PoolView, MatchAction } from "@/lib/bets";
import type { PariView } from "@/lib/parimutuel";

// A match card with its betting footer + action column wired in. Shared by the
// home page and the schedule page.
export function CardWithBetting({
  m,
  pools,
  action,
  pari,
  currentManager,
}: {
  m: MatchView;
  pools: PoolView[];
  action: MatchAction | null;
  pari: PariView | null;
  currentManager: string | null;
}) {
  const showBetting = m.status !== "post" || pools.length > 0;
  // Show the pot whenever there's money in it OR the match is still pre (so
  // someone can start one). PariPot itself returns null when neither holds.
  const showPari = m.status === "pre" || (pari?.pot ?? 0) > 0;
  return (
    <MatchCard
      match={m}
      action={action}
      href={`/match/${m.id}`}
      betting={
        showBetting || showPari ? (
          <>
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
            {showPari && (
              <PariPot
                view={pari}
                matchId={m.id}
                matchStatus={m.status as "pre" | "in" | "post"}
                homeCode={m.home.code}
                awayCode={m.away.code}
                homeName={m.home.name}
                awayName={m.away.name}
                currentManager={currentManager}
              />
            )}
          </>
        ) : undefined
      }
    />
  );
}
