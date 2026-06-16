import { getCurrentManager } from "@/lib/auth-guard";
import { styleFor } from "@/lib/managers";
import { getRules, getPlacements, type PlacementView } from "@/lib/autobet";
import { KickoffTime } from "@/components/KickoffTime";
import { LocalDailyTime } from "@/components/LocalDailyTime";
import { revertAutoBetAction, runNowAction } from "@/app/autobet-actions";
import { RuleList } from "@/components/RuleList";
import type { RuleCardData } from "@/components/RuleCard";

function MgrChip({ name }: { name: string }) {
  const s = styleFor(name);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
      {name}
    </span>
  );
}

function outcomeWord(outcome: string): string {
  if (outcome === "home") return "Home";
  if (outcome === "away") return "Away";
  return "Draw";
}

function ActivityLog({ placements }: { placements: PlacementView[] }) {
  if (placements.length === 0) {
    return <p className="text-sm text-zinc-500">No auto-bets placed yet.</p>;
  }
  return (
    <ul className="divide-y divide-white/5">
      {placements.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                p.action === "open" ? "bg-sky-500/15 text-sky-300" : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {p.action}
            </span>
            {p.editedAt && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-300">
                edited
              </span>
            )}
            <span className="truncate text-zinc-200">{p.matchLabel}</span>
            <span className="text-zinc-600 shrink-0">·</span>
            <span className="text-zinc-400 shrink-0">{outcomeWord(p.outcome)}</span>
          </div>
          <span className="text-xs text-zinc-600 shrink-0">
            {p.placedAt ? <KickoffTime iso={p.placedAt} /> : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export async function AutoBetPanel() {
  const current = await getCurrentManager();

  if (!current) {
    return (
      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Your Auto Bets</h2>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-500">Sign in to set up auto-bet.</p>
        </div>
      </section>
    );
  }

  const { manager, personId } = current;
  const [rules, placements] = await Promise.all([
    getRules(personId),
    getPlacements(personId),
  ]);

  const cards: RuleCardData[] = rules.map((r) => ({
    id: r.id,
    criteria: r.criteria,
    exclude: r.exclude,
    stake: r.stake,
    horizonDays: r.horizonDays,
    active: r.active,
  }));

  const hasRevertable = placements.some((p) => p.action === "open");

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Your Auto Bets</h2>
        <MgrChip name={manager} />
      </div>

      <RuleList rules={cards} />

      <p className="mt-3 text-[11px] text-zinc-600">
        Auto-bets run on their own roughly every 30 minutes (best-effort), plus a guaranteed daily
        sweep at <LocalDailyTime utcHour={12} /> (12:00 UTC) — or hit “Run now” to place immediately.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={runNowAction}>
          <button className="rounded-md border border-white/15 px-3 py-2 text-sm text-zinc-200 hover:bg-white/5">
            Run now
          </button>
        </form>
      </div>

      {hasRevertable && (
        <div className="mt-4">
          <form action={revertAutoBetAction}>
            <button className="rounded-md border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5">
              Cancel my open auto-bets
            </button>
          </form>
          <p className="mt-1.5 text-[11px] text-zinc-600">
            Cancels pools you opened that nobody else has joined yet. Joined and locked bets stay.
          </p>
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 text-zinc-500">Activity</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <ActivityLog placements={placements} />
        </div>
      </div>
    </section>
  );
}
