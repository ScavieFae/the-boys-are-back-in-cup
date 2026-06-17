import Link from "next/link";
import { styleFor } from "@/lib/managers";
import { RelativeTime } from "@/components/RelativeTime";
import type { FeedItem as FeedItemData } from "@/lib/feed";
import type { Outcome } from "@/lib/betting";

// A manager name chip — matches MgrChip in AutoBetPanel / bets page.
function MgrChip({ name }: { name: string }) {
  const s = styleFor(name);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
      {name}
    </span>
  );
}

type Match = NonNullable<FeedItemData["match"]>;

// outcome -> FIFA code (home->homeCode, away->awayCode, draw->"DRAW"), falling
// back to the team name when a code is null so we never render an empty token.
function codeFor(outcome: Outcome, match: Match | null): string {
  if (outcome === "draw") return "DRAW";
  if (outcome === "home") return match?.homeCode ?? match?.homeName ?? "HOME";
  return match?.awayCode ?? match?.awayName ?? "AWAY";
}

// "{homeCode} v {awayCode}" with name fallback.
function matchLabel(match: Match | null): string {
  if (!match) return "";
  const h = match.homeCode ?? match.homeName ?? "?";
  const a = match.awayCode ?? match.awayName ?? "?";
  return `${h} v ${a}`;
}

// A small leading dot/icon. Color carries the event's tone; muted/system events
// stay gray. Some types use a glyph instead of a dot.
function Dot({ tone, glyph }: { tone: string; glyph?: string }) {
  if (glyph) return <span className="w-4 shrink-0 text-center text-sm leading-5">{glyph}</span>;
  return (
    <span className="flex w-4 shrink-0 justify-center">
      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${tone}`} />
    </span>
  );
}

// Shared row chrome: leading dot, the body, a right-aligned relative timestamp.
function Row({
  dot,
  ts,
  children,
}: {
  dot: React.ReactNode;
  ts: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-2 text-sm">
      {dot}
      <div className="min-w-0 flex-1 leading-5 text-zinc-300">{children}</div>
      <RelativeTime iso={ts} />
    </div>
  );
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-[11px] text-zinc-400">{children}</span>
);
const MatchTag = ({ match }: { match: Match | null }) =>
  match ? (
    <>
      <span className="text-zinc-600"> · </span>
      <Link
        href={`/match/${match.id}`}
        className="font-mono text-[11px] text-zinc-500 transition hover:text-zinc-300"
      >
        {matchLabel(match)}
      </Link>
    </>
  ) : null;

// The "Join this bet" CTA on bet_opened. Live pool state from getFeed:
//  - open + has open spots + viewer signed in + not already in it -> a link to
//    the bets page anchored on this pool (no modal — the anchor is the MVP).
//  - otherwise a muted filled/closed tag (never a dead link).
function JoinCTA({ item, currentManager }: { item: FeedItemData; currentManager: string | null }) {
  const pool = item.pool;
  if (!pool) return null;

  if (pool.status !== "open" || pool.openSpots.length === 0) {
    const tag = pool.status === "open" ? "filled" : pool.status === "void" ? "voided" : "closed";
    return <span className="ml-1 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">{tag}</span>;
  }

  // Viewer must be signed in and not already in the pool. The feed row doesn't
  // carry per-spot ownership, so derive "already in it" conservatively: the
  // opener (actor) is by definition already in their own bet.
  if (!currentManager) return null;
  if (item.actor && item.actor === currentManager) return null;

  const spots = pool.openSpots
    .map((s) => `${codeFor(s.outcome, item.match)} $${s.buyin}`)
    .join(", ");

  return (
    <Link
      href={`/bets#pool-${pool.id}`}
      className="ml-1 inline-flex items-center rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300 transition hover:bg-sky-500/25"
    >
      Join — {spots}
    </Link>
  );
}

export function FeedItem({
  item,
  currentManager,
}: {
  item: FeedItemData;
  currentManager: string | null;
}) {
  const { type, match, payload, actor } = item;
  const chip = actor ? <MgrChip name={actor} /> : null;

  switch (type) {
    case "bet_opened": {
      const code = codeFor(payload?.outcome, match);
      return (
        <Row dot={<Dot tone="bg-sky-400" />} ts={item.ts}>
          {chip} <span>opened a bet</span> <span className="text-zinc-600">·</span>{" "}
          <span className="tabular-nums">${payload?.amount}</span> on <Code>{code}</Code>
          <MatchTag match={match} />
          <JoinCTA item={item} currentManager={currentManager} />
        </Row>
      );
    }

    case "bet_joined": {
      const code = codeFor(payload?.outcome, match);
      return (
        <Row dot={<Dot tone="bg-emerald-400" />} ts={item.ts}>
          {chip} took <Code>{code}</Code> (<span className="tabular-nums">${payload?.amount}</span>)
          <MatchTag match={match} />
        </Row>
      );
    }

    case "bet_filled":
      return (
        <Row dot={<Dot tone="bg-zinc-600" />} ts={item.ts}>
          <span className="text-zinc-500">
            Bet filled (3/3)
            <MatchTag match={match} />
          </span>
        </Row>
      );

    case "bet_edited": {
      const code = codeFor(payload?.outcome, match);
      const amount =
        payload?.oldAmount != null ? (
          <span className="tabular-nums">
            ${payload.oldAmount}→${payload.newAmount}
          </span>
        ) : (
          <span className="tabular-nums">${payload?.newAmount}</span>
        );
      return (
        <Row dot={<Dot tone="bg-amber-400" />} ts={item.ts}>
          {chip} changed their bet to {amount} on <Code>{code}</Code>
          <MatchTag match={match} />
        </Row>
      );
    }

    case "bet_canceled":
      return (
        <Row dot={<Dot tone="bg-zinc-600" />} ts={item.ts}>
          <span className="text-zinc-500">
            {chip} <span>canceled a bet</span>
            <MatchTag match={match} />
          </span>
        </Row>
      );

    case "bet_settled":
      return <SettledRow item={item} />;

    case "bet_voided":
      return (
        <Row dot={<Dot tone="bg-zinc-600" />} ts={item.ts}>
          <span className="text-zinc-500">
            Bet voided — didn&apos;t fill
            <MatchTag match={match} />
          </span>
        </Row>
      );

    case "match_started":
      return (
        <Row dot={<Dot glyph="⚽" tone="" />} ts={item.ts}>
          <span className="text-zinc-400">
            Kickoff
            <MatchTag match={match} />
          </span>
        </Row>
      );

    case "match_final":
      return (
        <Row dot={<Dot tone="bg-zinc-600" />} ts={item.ts}>
          <span className="text-zinc-500">
            Final <span className="font-mono text-[11px] text-zinc-400">{match?.homeCode ?? match?.homeName ?? "?"}</span>{" "}
            <span className="tabular-nums text-zinc-300">
              {payload?.homeScore}–{payload?.awayScore}
            </span>{" "}
            <span className="font-mono text-[11px] text-zinc-400">{match?.awayCode ?? match?.awayName ?? "?"}</span>
          </span>
        </Row>
      );

    case "pari_contributed": {
      const code = codeFor(payload?.outcome, match);
      return (
        <Row dot={<Dot glyph="🍯" tone="" />} ts={item.ts}>
          {chip} <span>put</span> <span className="tabular-nums">${payload?.amount}</span> on <Code>{code}</Code>{" "}
          <span className="text-zinc-500">in the pot</span>
          <MatchTag match={match} />
        </Row>
      );
    }

    case "pari_settled": {
      const code = codeFor(payload?.result, match);
      const winners: { manager: string | null; amount: number }[] = payload?.winners ?? [];
      return (
        <Row dot={<Dot glyph="🍯" tone="" />} ts={item.ts}>
          <span className="text-zinc-400">Pot settled</span>
          <MatchTag match={match} />
          <span className="text-zinc-600"> · </span>
          <Code>{code}</Code> <span className="text-zinc-500">took</span>{" "}
          <span className="tabular-nums text-emerald-400">${payload?.pot}</span>
          {winners.length > 0 && (
            <span className="ml-1">
              {winners.map((w, i) => (
                <span key={`${w.manager}-${i}`}>
                  {i > 0 && <span className="text-zinc-600">, </span>}
                  {w.manager ? <MgrChip name={w.manager} /> : <span className="text-zinc-500">—</span>}{" "}
                  <span className="tabular-nums text-zinc-500">+${Math.round(w.amount)}</span>
                </span>
              ))}
            </span>
          )}
        </Row>
      );
    }

    case "pari_void":
      return (
        <Row dot={<Dot tone="bg-zinc-600" />} ts={item.ts}>
          <span className="text-zinc-500">
            Pot refunded — no one had the winner
            <MatchTag match={match} />
          </span>
        </Row>
      );

    default:
      return null;
  }
}

// The centerpiece. Winner = the filled spot whose outcome === result. Losers =
// the other filled spots. Winner's net = sum of loser amounts (from flow). If
// the winning outcome has no manager (or no winning spot) -> a push.
function SettledRow({ item }: { item: FeedItemData }) {
  const { match, payload } = item;
  const result: Outcome | undefined = payload?.result;
  const spots: { outcome: Outcome; manager: string | null; amount: number }[] = payload?.spots ?? [];
  const flow: { from: Outcome; to: Outcome; amount: number }[] = payload?.flow ?? [];

  const winner = result != null ? spots.find((s) => s.outcome === result && s.manager) : undefined;
  const losers = winner ? spots.filter((s) => s !== winner && s.manager) : [];

  // Push: winning outcome had no taker (or no result) -> everyone refunded.
  if (!winner) {
    return (
      <Row dot={<Dot tone="bg-zinc-500" />} ts={item.ts}>
        <span className="text-zinc-400">
          Push
          <MatchTag match={match} />
          <span className="text-zinc-600"> · </span>
          <span className="text-zinc-500">everyone refunded</span>
        </span>
      </Row>
    );
  }

  const net = flow.length
    ? flow.filter((f) => f.to === winner.outcome).reduce((sum, f) => sum + f.amount, 0)
    : losers.reduce((sum, l) => sum + l.amount, 0);

  return (
    <Row dot={<Dot tone="bg-yellow-400" />} ts={item.ts}>
      <MgrChip name={winner.manager!} />{" "}
      <span className="text-zinc-500">
        (<span className="font-mono text-[11px] text-zinc-400">{codeFor(winner.outcome, match)}</span>,{" "}
        <span className="tabular-nums text-emerald-400">+${net}</span>)
      </span>{" "}
      <span>beat</span>{" "}
      {losers.map((l, i) => (
        <span key={l.outcome}>
          {i > 0 && <span className="text-zinc-600">, </span>}
          <MgrChip name={l.manager!} />{" "}
          <span className="text-zinc-500">
            (<span className="font-mono text-[11px] text-zinc-400">{codeFor(l.outcome, match)}</span>,{" "}
            <span className="tabular-nums text-red-400">−${l.amount}</span>)
          </span>
        </span>
      ))}
      <MatchTag match={match} />
    </Row>
  );
}
