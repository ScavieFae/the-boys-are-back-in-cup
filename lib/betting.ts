// The money math for three-spot betting pools.
//
// A pool has up to three spots — home / draw / away — each a single backer with
// a fixed buy-in. Buy-ins are sized so each spot is "that outcome at its
// (de-vigged) line": favorite costs more, underdog less. Whoever holds the
// winning outcome's spot takes the whole pot (sum of filled buy-ins). If the
// winning outcome's spot is empty, everyone is refunded (push). Fewer than two
// spots at kickoff voids the pool.
//
// Settlement only ever sums the ACTUAL buy-ins that were paid, so rounding the
// derived buy-ins never desyncs the ledger — the pot is always exactly the money
// on the table.

export type Outcome = "home" | "draw" | "away";
export const OUTCOMES: Outcome[] = ["home", "draw", "away"];

export interface ThreeWayOdds {
  home: string | number | null;
  draw: string | number | null;
  away: string | number | null;
}

// American odds -> implied probability (includes the book's vig).
export function americanToImpliedProb(odds: string | number): number {
  const n = typeof odds === "string" ? Number(odds) : odds;
  if (!Number.isFinite(n) || n === 0) return NaN;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

// Strip the vig: normalize the three implied probabilities to sum to 1.
export function deVig(odds: ThreeWayOdds): Record<Outcome, number> | null {
  const raw: Record<Outcome, number> = {
    home: odds.home == null ? NaN : americanToImpliedProb(odds.home),
    draw: odds.draw == null ? NaN : americanToImpliedProb(odds.draw),
    away: odds.away == null ? NaN : americanToImpliedProb(odds.away),
  };
  const sum = raw.home + raw.draw + raw.away;
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return { home: raw.home / sum, draw: raw.draw / sum, away: raw.away / sum };
}

export interface Buyins {
  home: number;
  draw: number;
  away: number;
}

// Given the creator's chosen spot + buy-in, derive the fair buy-in for all three
// spots (creator's stays exact; others scale by probability). `round` snaps the
// derived spots to whole dollars for friendlier Venmo settle-ups.
export function computeBuyins(
  probs: Record<Outcome, number>,
  creatorOutcome: Outcome,
  creatorBuyin: number,
  round = true,
): Buyins {
  const pot = creatorBuyin / probs[creatorOutcome]; // total if all three fill
  const val = (o: Outcome) =>
    o === creatorOutcome ? creatorBuyin : round ? Math.round(probs[o] * pot) : probs[o] * pot;
  return { home: val("home"), draw: val("draw"), away: val("away") };
}

// What the holder of `outcome` would win right now, given which spots are filled.
// (Pot grows as more spots fill — this is the "your winnings can grow" property.)
export function potentialProfit(
  filled: Partial<Record<Outcome, number>>,
  outcome: Outcome,
): number {
  if (filled[outcome] == null) return 0;
  let others = 0;
  for (const o of OUTCOMES) if (o !== outcome && filled[o] != null) others += filled[o]!;
  return others; // winner keeps their own buy-in and takes everyone else's
}

export interface LedgerEntry {
  from: Outcome; // losing spot
  to: Outcome; // winning spot
  amount: number;
}

export type Settlement =
  | { status: "void"; reason: "not_enough_spots" }
  | { status: "push"; refunded: Outcome[] }
  | { status: "win"; winner: Outcome; pot: number; entries: LedgerEntry[] };

// Settle a pool given which spots were filled (buy-in amounts) and the result.
export function settlePool(
  filled: Partial<Record<Outcome, number>>,
  result: Outcome,
): Settlement {
  const present = OUTCOMES.filter((o) => filled[o] != null);
  if (present.length < 2) return { status: "void", reason: "not_enough_spots" };

  // Winning outcome's spot was never taken -> nobody owns it -> push.
  if (filled[result] == null) return { status: "push", refunded: present };

  const entries: LedgerEntry[] = present
    .filter((o) => o !== result)
    .map((o) => ({ from: o, to: result, amount: filled[o]! }));
  const pot = present.reduce((s, o) => s + filled[o]!, 0);
  return { status: "win", winner: result, pot, entries };
}
