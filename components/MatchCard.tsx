import type { MatchView } from "@/lib/queries";
import type { MatchAction } from "@/lib/bets";
import type { Outcome } from "@/lib/betting";
import { OwnerChip } from "./OwnerChip";
import { KickoffTime } from "./KickoffTime";
import { BroadcastBadge } from "./BroadcastBadge";

function ActionCol({ action, match, isFinal }: { action: MatchAction; match: MatchView; isFinal: boolean }) {
  const rows: { o: Outcome; label: string }[] = [
    { o: "home", label: match.home.code ?? "Home" },
    { o: "draw", label: "Draw" },
    { o: "away", label: match.away.code ?? "Away" },
  ];
  const winnerHasBettors = isFinal && !!action.result && action[action.result].bettors.length > 0;
  const push = isFinal && !!action.result && action[action.result].bettors.length === 0;
  return (
    <div className="w-28 shrink-0 border-l border-white/10 pl-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Action</div>
      <div className="space-y-1">
        {rows.map(({ o, label }) => {
          const oa = action[o];
          const won = winnerHasBettors && action.result === o;
          return (
            <div key={o}>
              <div className={`flex items-center justify-between text-[11px] ${won ? "text-emerald-400" : "text-zinc-300"}`}>
                <span className="font-mono">{label}{won ? " ✓" : ""}</span>
                <span className="tabular-nums">{oa.staked > 0 ? `$${oa.staked}` : "—"}</span>
              </div>
              {oa.bettors.length > 0 && (
                <div className={`text-[9px] truncate ${won ? "text-emerald-500/80" : "text-zinc-600"}`}>
                  {oa.bettors.join(", ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {push && <div className="text-[9px] text-zinc-500 mt-1">Push — refunded</div>}
    </div>
  );
}

function RedCards({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="text-[10px] leading-none shrink-0" title={`${n} red card${n > 1 ? "s" : ""}`}>
      🟥{n > 1 ? <span className="text-zinc-400">×{n}</span> : null}
    </span>
  );
}

function Side({
  name,
  code,
  owner,
  score,
  redCards,
  showScore,
  winner,
}: {
  name: string;
  code: string | null;
  owner: string | null;
  score: number | null;
  redCards: number;
  showScore: boolean;
  winner: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="font-mono text-[10px] text-zinc-500 w-8 shrink-0">{code ?? "—"}</span>
        <span className={`truncate ${winner ? "font-semibold text-white" : "text-zinc-200"}`}>{name}</span>
        <OwnerChip owner={owner} />
        <RedCards n={redCards} />
      </div>
      {showScore && (
        <span className={`tabular-nums text-lg ${winner ? "font-bold text-white" : "text-zinc-400"}`}>
          {score ?? 0}
        </span>
      )}
    </div>
  );
}

export function MatchCard({
  match,
  betting,
  action,
}: {
  match: MatchView;
  betting?: React.ReactNode;
  action?: MatchAction | null;
}) {
  const isLive = match.status === "in";
  const isFinal = match.status === "post";
  const showScore = isLive || isFinal;

  const hs = match.home.score ?? 0;
  const as = match.away.score ?? 0;
  const homeWin = isFinal && hs > as;
  const awayWin = isFinal && as > hs;

  const showOdds = match.odds && !isLive;

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

      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <Side {...match.home} showScore={showScore} winner={homeWin} />
          <Side {...match.away} showScore={showScore} winner={awayWin} />
        </div>
        {action && action.totalStaked > 0 && (
          <ActionCol action={action} match={match} isFinal={isFinal} />
        )}
      </div>

      {!isFinal && match.broadcast && (
        <div className="mt-1.5">
          <BroadcastBadge broadcast={match.broadcast} watchUrl={match.watchUrl} live={isLive} />
        </div>
      )}

      {showOdds && (
        <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-zinc-500">
          <span className="uppercase tracking-wide text-zinc-600">
            {isFinal ? "Closing odds" : "Odds"}
          </span>
          <span>{match.home.code ?? "H"} <span className="text-zinc-300">{match.odds!.home ?? "—"}</span></span>
          <span>Draw <span className="text-zinc-300">{match.odds!.draw ?? "—"}</span></span>
          <span>{match.away.code ?? "A"} <span className="text-zinc-300">{match.odds!.away ?? "—"}</span></span>
          {match.odds!.provider && <span className="text-zinc-700 ml-auto">{match.odds!.provider}</span>}
        </div>
      )}

      {betting}
    </div>
  );
}
