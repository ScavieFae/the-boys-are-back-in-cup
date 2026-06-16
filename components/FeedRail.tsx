import Link from "next/link";
import { styleFor } from "@/lib/managers";
import { FeedItem } from "@/components/FeedItem";
import { RelativeTime } from "@/components/RelativeTime";
import type { FeedItem as FeedItemData } from "@/lib/feed";

function MgrChip({ name }: { name: string }) {
  const s = styleFor(name);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
      {name}
    </span>
  );
}

// Group consecutive items (already newest-first) that share the same non-null
// runId AND same actor. A run of 2+ collapses into one summary row; a lone auto
// event (or anything with a null runId) renders as a normal single item.
type Group =
  | { kind: "single"; item: FeedItemData }
  | { kind: "batch"; runId: string; actor: string | null; items: FeedItemData[] };

function groupItems(items: FeedItemData[]): Group[] {
  const groups: Group[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (cur.runId != null) {
      let j = i + 1;
      while (j < items.length && items[j].runId === cur.runId && items[j].actor === cur.actor) j++;
      const run = items.slice(i, j);
      if (run.length > 1) {
        groups.push({ kind: "batch", runId: cur.runId, actor: cur.actor, items: run });
        i = j;
        continue;
      }
    }
    groups.push({ kind: "single", item: cur });
    i++;
  }
  return groups;
}

// Collapsed auto-batch: a summary line ("placed N auto-bets") with a native
// <details> disclosure listing the individual lines beneath. Native <details>
// keeps this a server component — no client toggle needed.
function BatchRow({
  group,
  currentManager,
}: {
  group: Extract<Group, { kind: "batch" }>;
  currentManager: string | null;
}) {
  const { actor, items } = group;
  const newest = items[0];
  return (
    <details className="group py-2 text-sm [&_summary]:list-none">
      <summary className="flex cursor-pointer items-start gap-2">
        <span className="flex w-4 shrink-0 justify-center">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sky-400" />
        </span>
        <div className="min-w-0 flex-1 leading-5 text-zinc-300">
          {actor ? <MgrChip name={actor} /> : <span className="text-zinc-400">Auto-bet</span>}{" "}
          <span>placed</span> <span className="tabular-nums font-medium text-zinc-200">{items.length}</span>{" "}
          <span>auto-bets</span>
          <span className="ml-1 text-[11px] text-zinc-600 group-open:hidden">▸</span>
          <span className="ml-1 hidden text-[11px] text-zinc-600 group-open:inline">▾</span>
        </div>
        <RelativeTime iso={newest.ts} />
      </summary>
      <div className="ml-4 mt-0.5 border-l border-white/10 pl-3">
        {items.map((it) => (
          <FeedItem key={it.id} item={it} currentManager={currentManager} />
        ))}
      </div>
    </details>
  );
}

export function FeedRail({
  items,
  currentManager,
  showSeeAll = false,
  title = "Activity",
}: {
  items: FeedItemData[];
  currentManager: string | null;
  showSeeAll?: boolean;
  title?: string;
}) {
  const groups = groupItems(items);

  return (
    <section className="flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
        {showSeeAll && (
          <Link href="/feed" className="text-xs text-zinc-400 transition hover:text-white">
            See all →
          </Link>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="px-4 py-4 text-sm text-zinc-500">No activity yet.</p>
      ) : (
        <div className="max-h-[28rem] flex-1 overflow-y-auto px-4 py-1 divide-y divide-white/5 lg:max-h-none lg:min-h-0">
          {groups.map((g) =>
            g.kind === "batch" ? (
              <BatchRow key={`batch-${g.items[0].id}`} group={g} currentManager={currentManager} />
            ) : (
              <FeedItem key={g.item.id} item={g.item} currentManager={currentManager} />
            ),
          )}
        </div>
      )}
    </section>
  );
}
