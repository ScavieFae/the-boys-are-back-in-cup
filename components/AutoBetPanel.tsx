import { getCurrentManager } from "@/lib/auth-guard";
import { styleFor } from "@/lib/managers";
import {
  getRule,
  previewAutoBets,
  getPlacements,
  type AutoBetCriteria,
  type PreviewItem,
  type PlacementView,
} from "@/lib/autobet";
import { KickoffTime } from "@/components/KickoffTime";
import { saveAutoBetAction, revertAutoBetAction } from "@/app/autobet-actions";

const CRITERIA_OPTIONS: { value: AutoBetCriteria; label: string }[] = [
  { value: "draw", label: "Always Draw" },
  { value: "my_teams", label: "My Teams" },
  { value: "home", label: "Always Home" },
  { value: "away", label: "Always Away" },
  { value: "favorite", label: "Favorite" },
  { value: "underdog", label: "Underdog" },
];

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

function PreviewList({ items }: { items: PreviewItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">Nothing queued right now.</p>;
  }
  return (
    <ul className="divide-y divide-white/5">
      {items.map((it, i) => (
        <li key={`${it.matchId}-${it.action}-${i}`} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                it.action === "open" ? "bg-sky-500/15 text-sky-300" : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {it.action}
            </span>
            <span className="truncate text-zinc-200">{it.matchLabel}</span>
            <span className="text-zinc-600 shrink-0">·</span>
            <span className="text-zinc-400 shrink-0">{outcomeWord(it.outcome)}</span>
          </div>
          <span className="tabular-nums font-semibold text-zinc-200 shrink-0">${it.amount}</span>
        </li>
      ))}
    </ul>
  );
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
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-zinc-400">Your Auto-Bet</h2>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-500">Sign in to set up auto-bet.</p>
        </div>
      </section>
    );
  }

  const { manager, personId } = current;
  const [rule, preview, placements] = await Promise.all([
    getRule(personId),
    previewAutoBets(personId),
    getPlacements(personId),
  ]);

  const criteria = rule?.criteria ?? "draw";
  const stake = rule?.stake ?? 10;
  const horizonDays = rule?.horizonDays ?? 2;
  const active = rule?.active ?? false;

  const hasRevertable = placements.some((p) => p.action === "open");

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Your Auto-Bet</h2>
        <MgrChip name={manager} />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <form action={saveAutoBetAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Rule</span>
              <select
                name="criteria"
                defaultValue={criteria}
                className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none focus:border-white/30"
              >
                {CRITERIA_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Stake ($)</span>
              <input
                type="number"
                name="stake"
                defaultValue={stake}
                min={1}
                className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm tabular-nums outline-none focus:border-white/30"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Horizon (days)</span>
              <input
                type="number"
                name="horizonDays"
                defaultValue={horizonDays}
                min={1}
                className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm tabular-nums outline-none focus:border-white/30"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                name="active"
                defaultChecked={active}
                className="h-4 w-4 rounded border-white/20 bg-white/5 accent-emerald-500"
              />
              <span>Active</span>
              <span className="text-xs text-zinc-600">— place these bets automatically</span>
            </label>
            <button className="rounded-md bg-white text-black px-4 py-2 text-sm font-medium hover:bg-zinc-200">
              Save
            </button>
          </div>
        </form>
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 text-zinc-500">What this would place</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="mb-2 text-xs text-zinc-600">
            A dry run of your saved rule on the current schedule — shown whether it&apos;s on or off.
            {!active && " Turn it on and save to actually place these."}
          </p>
          <PreviewList items={preview} />
        </div>
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
