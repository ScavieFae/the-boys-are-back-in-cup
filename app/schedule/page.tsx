import { getAllMatchViews } from "@/lib/queries";
import { getAllPoolViews, getMatchActions } from "@/lib/bets";
import { getCurrentManager } from "@/lib/auth-guard";
import { freshenIfStale } from "@/lib/sync";
import { CardWithBetting } from "@/components/CardWithBetting";
import type { MatchView } from "@/lib/queries";
import type { PoolView } from "@/lib/bets";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Group by US Eastern date (EDT, -4h in summer) so late-evening kickoffs stay
// grouped with their matchday instead of spilling into the next UTC date.
function dayKey(iso: string): string {
  return new Date(Date.parse(iso) - 4 * 3600 * 1000).toISOString().slice(0, 10);
}
function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${MONTHS[m - 1]} ${d}`;
}

export default async function SchedulePage() {
  await freshenIfStale();

  const [allMatches, poolViews, actions, me] = await Promise.all([
    getAllMatchViews(),
    getAllPoolViews(),
    getMatchActions(),
    getCurrentManager(),
  ]);
  const currentManager = me?.manager ?? null;

  const poolsByMatch = new Map<number, PoolView[]>();
  for (const p of poolViews.open) {
    if (!poolsByMatch.has(p.matchId)) poolsByMatch.set(p.matchId, []);
    poolsByMatch.get(p.matchId)!.push(p);
  }

  // Forward-looking: live + upcoming only (finished games live on the home page
  // and the Bets history).
  const matches = allMatches.filter((m) => m.status !== "post");

  const groups = new Map<string, MatchView[]>();
  for (const m of matches) {
    const k = dayKey(m.kickoffUtc);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m);
  }
  const days = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Every upcoming fixture, by day. Start a bet on any of them.
        </p>
      </div>

      {days.length === 0 ? (
        <p className="text-sm text-zinc-600">No upcoming fixtures — the tournament&apos;s wrapped.</p>
      ) : (
        days.map(([key, ms]) => (
          <section key={key} className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">
              {dayLabel(key)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 items-start">
              {ms.map((m) => (
                <CardWithBetting
                  key={m.id}
                  m={m}
                  pools={poolsByMatch.get(m.id) ?? []}
                  action={actions.get(m.id) ?? null}
                  currentManager={currentManager}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
