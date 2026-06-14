import { MatchCard } from "@/components/MatchCard";
import { MatchBetting } from "@/components/MatchBetting";
import type { MatchView } from "@/lib/queries";
import type { PoolView, MatchAction } from "@/lib/bets";

// A match card with its betting footer + action column wired in. Shared by the
// home page and the schedule page.
export function CardWithBetting({
  m,
  pools,
  action,
  currentManager,
}: {
  m: MatchView;
  pools: PoolView[];
  action: MatchAction | null;
  currentManager: string | null;
}) {
  const showBetting = m.status === "pre" || pools.length > 0;
  return (
    <MatchCard
      match={m}
      action={action}
      betting={
        showBetting ? (
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
        ) : undefined
      }
    />
  );
}
