import type { MatchView } from "@/lib/queries";
import { OwnerChip } from "./OwnerChip";
import { KickoffTime } from "./KickoffTime";

function Side({
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
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="font-mono text-[10px] text-zinc-500 w-8 shrink-0">{code ?? "—"}</span>
        <span className={`truncate ${winner ? "font-semibold text-white" : "text-zinc-200"}`}>{name}</span>
        <OwnerChip owner={owner} />
      </div>
      {showScore && (
        <span className={`tabular-nums text-lg ${winner ? "font-bold text-white" : "text-zinc-400"}`}>
          {score ?? 0}
        </span>
      )}
    </div>
  );
}

export function MatchCard({ match }: { match: MatchView }) {
  const isLive = match.status === "in";
  const isFinal = match.status === "post";
  const showScore = isLive || isFinal;

  const hs = match.home.score ?? 0;
  const as = match.away.score ?? 0;
  const homeWin = isFinal && hs > as;
  const awayWin = isFinal && as > hs;

  return (
    <div
      className={`rounded-xl border p-4 ${
        isLive ? "border-red-500/40 bg-red-500/[0.04]" : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center justify-between mb-2 text-xs">
        <span className="text-zinc-500">
          {match.groupLetter ? `Group ${match.groupLetter}` : match.stage ?? ""}
        </span>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-red-400">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-red-500" />
            {match.statusDetail || "LIVE"}
          </span>
        ) : isFinal ? (
          <span className="font-medium text-zinc-400">{match.statusDetail || "Full Time"}</span>
        ) : (
          <span className="text-zinc-400">
            <KickoffTime iso={match.kickoffUtc} />
          </span>
        )}
      </div>
      <Side {...match.home} showScore={showScore} winner={homeWin} />
      <Side {...match.away} showScore={showScore} winner={awayWin} />
    </div>
  );
}
